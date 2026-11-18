// The few Chrome extension APIs Strongroom uses, typed by hand so no @types package is needed.
declare namespace chrome {
  namespace storage {
    interface Area {
      get(keys?: string | string[] | null): Promise<Record<string, any>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }): Promise<void>;
    }
    const local: Area;
    const session: Area;
  }
  namespace runtime {
    const id: string;
    function getURL(path: string): string;
    function sendMessage(message: unknown): Promise<any>;
    interface MessageSender { id?: string; url?: string; tab?: { id?: number } }
    const onMessage: {
      addListener(cb: (message: any, sender: MessageSender, sendResponse: (reply: unknown) => void) => boolean | void): void;
    };
  }
  namespace alarms {
    function create(name: string, info: { delayInMinutes?: number; periodInMinutes?: number }): Promise<void>;
    function clear(name: string): Promise<boolean>;
    const onAlarm: { addListener(cb: (alarm: { name: string }) => void): void };
  }
  namespace action {
    function setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
    function openPopup(): Promise<void>;
  }
  namespace tabs {
    function query(info: { active: boolean; currentWindow: boolean }): Promise<{ id?: number; url?: string }[]>;
    function create(props: { url: string }): Promise<unknown>;
    function sendMessage(tabId: number, message: unknown): Promise<any>;
    const onUpdated: { addListener(cb: (tabId: number, info: { status?: string }) => void): void };
  }
}
