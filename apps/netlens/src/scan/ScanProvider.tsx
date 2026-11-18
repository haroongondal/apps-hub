/**
 * Scan state lives above the tabs: a scan started on one tab keeps running and
 * shows on the others, and leaving the Devices tab no longer drops the list.
 * Flow: detect interface → sweep the clamped /24 (live events) → enrich alive
 * hosts with SSDP/mDNS facts → reconcile into the local store → look up device
 * names in the background and fill them in as they arrive. Names never feed the
 * reconcile enrichment, so they cannot change a device's identity.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  TcpScanEngine,
  applyDeviceNames,
  carryPersonTags,
  cleanMdnsInstanceName,
  computeSubnetForHost,
  hashNetworkId,
  normalizeNetworkName,
  reconcileScan,
  resolveDeviceNames,
  type DeviceNames,
  type DeviceStore,
  type DiscoveredHost,
  type HostEnrichment,
  type InterfaceInfo,
  type NameTarget,
  type NetLensNativeBinding,
  type ReconciledDevice,
  type ServiceEvent,
  type StoredNetwork,
  type SubnetPlan,
} from '@apps-hub/core';
import { createNetLensNativeBinding } from 'netlens-core';

import { openDeviceStore, type SettingsStore } from '../db/device-store-sqlite';

export type Phase = 'idle' | 'scanning' | 'reconciling' | 'done' | 'error';

/** Most UPnP description URLs kept per device. */
const MAX_SSDP_LOCATIONS = 8;

/** mDNS/SSDP enrichment window appended around the sweep (SPEC §3.3). */
const SERVICE_DISCOVERY_MS = 4000;

export interface NetworkScan {
  iface: InterfaceInfo | null;
  plan: SubnetPlan | null;
  phase: Phase;
  discovered: number;
  devices: ReconciledDevice[];
  mdnsTypes: string[];
  errorNote: string | null;
  locationsByIp: ReadonlyMap<string, string[]>;
  store: (DeviceStore & SettingsStore) | null;
  runScan(): Promise<void>;
  stopScan(): Promise<void>;
  /** Merges the patch onto the latest row of that device (names may have arrived since the caller read it) and saves it. */
  saveDevice(id: number | null, patch: Partial<ReconciledDevice>): Promise<void>;
  /** Removes the row at once and puts it back if the store refuses. */
  forgetDevice(device: ReconciledDevice): Promise<void>;
  /** Network of the last finished scan, and the name the person gave it. */
  currentNetworkId: string | null;
  networkName: string | null;
  /** Filled by loadNetworks(), most recently scanned first. */
  savedNetworks: StoredNetwork[];
  /** Resolves false (with errorNote set) when the store could not be read. */
  loadNetworks(): Promise<boolean>;
  /** Empty or blank names clear the custom name. */
  renameNetwork(network: StoredNetwork, draft: string): Promise<void>;
  /** Forgets the network and its devices; resolves true when it was removed. Clears the scan if it was the current one. */
  forgetNetwork(network: StoredNetwork): Promise<boolean>;
  binding: NetLensNativeBinding;
}

const ScanContext = createContext<NetworkScan | null>(null);

export function useNetworkScan(): NetworkScan {
  const scan = useContext(ScanContext);
  if (scan === null) throw new Error('useNetworkScan must be used inside <ScanProvider>.');
  return scan;
}

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const bindingProxy = useRef(createNetLensNativeBinding()).current;
  const engineProxy = useRef(new TcpScanEngine(bindingProxy)).current;
  // Bumped when a scan starts and on unmount; a name lookup from an older scan sees a mismatch and does nothing.
  const scanGeneration = useRef(0);
  // Latest rows, updated in step with state, so name merges and edits build on current data.
  const devicesRef = useRef<ReconciledDevice[]>([]);
  // Every UPnP description URL the last scan saw per IP, for the device sheet's remote controls.
  const locationsByIp = useRef<Map<string, string[]>>(new Map()).current;

  const [store, setStore] = useState<(DeviceStore & SettingsStore) | null>(null);
  const [iface, setIface] = useState<InterfaceInfo | null>(null);
  const [plan, setPlan] = useState<SubnetPlan | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [discovered, setDiscovered] = useState(0);
  const [devices, setDevices] = useState<ReconciledDevice[]>([]);
  const commitDevices = useCallback((rows: ReconciledDevice[]): void => {
    devicesRef.current = rows;
    setDevices(rows);
  }, []);
  const [errorNote, setErrorNote] = useState<string | null>(null);
  const [mdnsTypes, setMdnsTypes] = useState<string[]>([]);
  const [currentNetworkId, setCurrentNetworkId] = useState<string | null>(null);
  const [networkName, setNetworkName] = useState<string | null>(null);
  const [savedNetworks, setSavedNetworks] = useState<StoredNetwork[]>([]);

  useEffect(() => {
    let cancelled = false;
    openDeviceStore()
      .then((opened) => {
        if (cancelled) return;
        setStore(opened);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErrorNote(`HomeNet could not open its device list on this phone: ${e instanceof Error ? e.message : String(e)}`);
      });
    bindingProxy.detectInterface().then((info) => {
      if (!cancelled) setIface(info);
    });
    return () => {
      cancelled = true;
      scanGeneration.current += 1;
    };
  }, [bindingProxy]);

  const scanning = phase === 'scanning' || phase === 'reconciling';

  // Moves a person's tag to the same phone's new row; carryPersonTags returns only changed rows, so a second pass is empty.
  const carryTags = useCallback(
    (target: DeviceStore, generation: number): void => {
      const changed = carryPersonTags(devicesRef.current);
      const rows = changed.filter((row) => row.id !== null);
      if (rows.length === 0) return;
      const byId = new Map(rows.map((row) => [row.id, row]));
      commitDevices(devicesRef.current.map((row) => byId.get(row.id) ?? row));
      for (const row of rows) {
        target.updateDevice(row).catch((e: unknown) => {
          if (scanGeneration.current !== generation) return;
          setErrorNote(`HomeNet could not save who is home: ${e instanceof Error ? e.message : String(e)}`);
        });
      }
    },
    [commitDevices],
  );

  const runScan = useCallback(async () => {
    if (!store || scanning) return;
    scanGeneration.current += 1;
    const generation = scanGeneration.current;
    setErrorNote(null);
    setDiscovered(0);
    setPhase('scanning');
    try {
      const info = await bindingProxy.detectInterface();
      setIface(info);
      if (!info) {
        throw new Error("This phone isn't connected to a Wi-Fi network.");
      }
      const planned = computeSubnetForHost(info.localIp, info.cidrPrefix);
      setPlan(planned);

      // Enrichment buffers, filled by native events while the sweep runs.
      const ssdpByIp = new Map<
        string,
        { usn: string | null; vendor: string | null; locations: string[] }
      >();
      const mdnsByIp = new Map<string, string>();
      const mdns = new Set<string>();
      const collectedTargets: DiscoveredHost[] = [];

      const serviceHandle = bindingProxy.addListener(
        'onServiceDiscovered',
        (event: ServiceEvent): void => {
          if (event.kind === 'mdns') {
            if (typeof event.serviceName === 'string') mdns.add(event.serviceName);
            return;
          }
          if (typeof event.host !== 'string' || !event.host) return;
          if (event.kind === 'mdns-instance') {
            // First usable name per host wins; a device announces many services.
            // Keep the raw text: resolveDeviceNames is the one place that cleans it.
            if (
              typeof event.instanceName === 'string' &&
              !mdnsByIp.has(event.host) &&
              cleanMdnsInstanceName(event.instanceName) !== null
            ) {
              mdnsByIp.set(event.host, event.instanceName);
            }
            return;
          }
          if (event.kind === 'ssdp') {
            const prev = ssdpByIp.get(event.host);
            const locations = prev?.locations ?? [];
            // A device on the LAN can spam SSDP, so the list stays short.
            if (
              typeof event.location === 'string' &&
              !locations.includes(event.location) &&
              locations.length < MAX_SSDP_LOCATIONS
            ) {
              locations.push(event.location);
            }
            ssdpByIp.set(event.host, {
              usn: typeof event.usn === 'string' ? event.usn : (prev?.usn ?? null),
              vendor: typeof event.server === 'string' ? event.server : (prev?.vendor ?? null),
              locations,
            });
          }
        },
      );
      const hostHandle = bindingProxy.addListener(
        'onHostDiscovered',
        (host: DiscoveredHost): void => {
          collectedTargets.push(host);
          if (host.isReachable) {
            setDiscovered((count) => Math.min(count + 1, planned.hosts.length));
          }
        },
      );

      try {
        const [scanSummary] = await Promise.all([
          engineProxy.scanOnce({ requestedPrefix: info.cidrPrefix }),
          engineProxy.discoverServices(SERVICE_DISCOVERY_MS),
        ]);

        setMdnsTypes([...mdns].sort());
        if (scanGeneration.current === generation) {
          // Mutated in place so the map handed out through the hook is always the current one.
          locationsByIp.clear();
          for (const [ip, facts] of ssdpByIp) locationsByIp.set(ip, facts.locations);
        }
        setPhase('reconciling');

        const reachable = scanSummary.discovered.filter((entry) => entry.isReachable);
        const enrichment: Record<string, HostEnrichment> = {};
        for (const entry of reachable) {
          const facts = ssdpByIp.get(entry.ip) ?? null;
          enrichment[entry.ip] = {
            usn: facts?.usn ?? null,
            vendorOrModel: facts?.vendor ?? null,
          };
        }
        const result = await reconcileScan(
          {
            networkId: hashNetworkId(info.gatewayIp ?? info.localIp, planned.prefix),
            gatewayIp: info.gatewayIp,
            subnetCidr: `${planned.networkIp}/${planned.prefix}`,
            // Prefer the engine's collected set; the parallel-collected copy
            // is a live mirror used only for the progress counter.
            hosts: reachable.length > 0 ? reachable : collectedTargets,
            enrichmentByIp: enrichment,
          },
          store,
        );
        commitDevices(result.devices);
        carryTags(store, generation);
        setCurrentNetworkId(result.networkId);
        setPhase('done');
        store
          .listNetworks()
          .then((saved) => {
            if (scanGeneration.current !== generation) return;
            setNetworkName(saved.find((n) => n.networkId === result.networkId)?.customName ?? null);
          })
          .catch(() => undefined);

        // Names come after the sweep so they can't slow it down. Each one is
        // merged and saved as it arrives; lookup failures just mean no name.
        const onNames = (ip: string, names: DeviceNames): void => {
          if (scanGeneration.current !== generation) return;
          const row = devicesRef.current.find((d) => d.seenThisScan && d.lastIp === ip);
          if (!row) return;
          const merged: ReconciledDevice = { ...row, ...applyDeviceNames(row, names) };
          if (
            merged.hostname === row.hostname &&
            merged.mdnsName === row.mdnsName &&
            merged.friendlyName === row.friendlyName &&
            merged.model === row.model &&
            merged.netbiosName === row.netbiosName &&
            merged.mac === row.mac &&
            merged.person === row.person
          ) {
            return;
          }
          commitDevices(devicesRef.current.map((d) => (d.id === merged.id ? merged : d)));
          store.updateDevice(merged).catch((e: unknown) => {
            if (scanGeneration.current !== generation) return;
            setErrorNote(`HomeNet could not save the device names it found: ${e instanceof Error ? e.message : String(e)}`);
          });
          // A new row only gets a hostname or Bonjour name here, so this is when a tag can carry over.
          carryTags(store, generation);
        };
        const nameTargets: NameTarget[] = result.devices
          .filter((d) => d.seenThisScan)
          .map((d) => ({
            ip: d.lastIp,
            ssdpLocation: ssdpByIp.get(d.lastIp)?.locations[0] ?? null,
            mdnsName: mdnsByIp.get(d.lastIp) ?? null,
          }));
        if (scanGeneration.current !== generation) return;
        void resolveDeviceNames(bindingProxy, nameTargets, info.gatewayIp, onNames);
      } finally {
        serviceHandle.remove();
        hostHandle.remove();
      }
    } catch (error: unknown) {
      setErrorNote(error instanceof Error ? error.message : String(error));
      setPhase('error');
    }
  }, [bindingProxy, carryTags, commitDevices, engineProxy, scanning, store]);

  const stopScan = useCallback(async () => {
    await Promise.allSettled([
      engineProxy.stop(),
      engineProxy.stopServiceDiscovery(),
    ]);
  }, [engineProxy]);

  const saveDevice = useCallback(
    async (id: number | null, patch: Partial<ReconciledDevice>): Promise<void> => {
      const latest = devicesRef.current.find((row) => row.id === id);
      if (!store || !latest) return;
      const updated: ReconciledDevice = { ...latest, ...patch };
      // Commit before the write so a name arriving meanwhile builds on this edit.
      commitDevices(devicesRef.current.map((row) => (row.id === updated.id ? updated : row)));
      try {
        await store.updateDevice(updated);
      } catch (e: unknown) {
        setErrorNote(`HomeNet could not save your changes to this device: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [commitDevices, store],
  );

  const forgetDevice = useCallback(
    async (device: ReconciledDevice): Promise<void> => {
      if (!store || device.id === null) return;
      const id = device.id;
      const before = devicesRef.current;
      commitDevices(before.filter((row) => row.id !== id));
      try {
        await store.deleteDevice(id);
      } catch (e: unknown) {
        commitDevices(before);
        setErrorNote(`HomeNet could not forget this device: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [commitDevices, store],
  );

  const loadNetworks = useCallback(async (): Promise<boolean> => {
    if (!store) return false;
    try {
      setSavedNetworks(await store.listNetworks());
      return true;
    } catch (e: unknown) {
      setErrorNote(`HomeNet could not read your saved networks: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }, [store]);

  const renameNetwork = useCallback(
    async (network: StoredNetwork, draft: string): Promise<void> => {
      if (!store) return;
      const customName = normalizeNetworkName(draft);
      try {
        await store.renameNetwork(network.networkId, customName);
        setSavedNetworks((rows) => rows.map((row) => (row.networkId === network.networkId ? { ...row, customName } : row)));
        if (network.networkId === currentNetworkId) setNetworkName(customName);
      } catch (e: unknown) {
        setErrorNote(`HomeNet could not rename this network: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [currentNetworkId, store],
  );

  const forgetNetwork = useCallback(
    async (network: StoredNetwork): Promise<boolean> => {
      if (!store) return false;
      try {
        await store.deleteNetwork(network.networkId);
      } catch (e: unknown) {
        setErrorNote(`HomeNet could not forget this network: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      }
      setSavedNetworks((rows) => rows.filter((row) => row.networkId !== network.networkId));
      if (network.networkId !== currentNetworkId) return true;
      // Name lookups still running for this scan must not write to the forgotten rows.
      scanGeneration.current += 1;
      commitDevices([]);
      setCurrentNetworkId(null);
      setNetworkName(null);
      setMdnsTypes([]);
      setPlan(null);
      setPhase('idle');
      return true;
    },
    [commitDevices, currentNetworkId, store],
  );

  const value = useMemo<NetworkScan>(
    () => ({
      iface,
      plan,
      phase,
      discovered,
      devices,
      mdnsTypes,
      errorNote,
      locationsByIp,
      store,
      runScan,
      stopScan,
      saveDevice,
      forgetDevice,
      currentNetworkId,
      networkName,
      savedNetworks,
      loadNetworks,
      renameNetwork,
      forgetNetwork,
      binding: bindingProxy,
    }),
    [
      bindingProxy,
      currentNetworkId,
      devices,
      discovered,
      errorNote,
      forgetDevice,
      forgetNetwork,
      iface,
      loadNetworks,
      locationsByIp,
      mdnsTypes,
      networkName,
      phase,
      plan,
      renameNetwork,
      runScan,
      saveDevice,
      savedNetworks,
      stopScan,
      store,
    ],
  );

  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
}

