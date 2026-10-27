Pod::Spec.new do |s|
  s.name           = 'OpenTunnelNative'
  s.version        = '0.1.0'
  s.summary        = 'OpenTunnel native tunnel bridge (Expo Modules API)'
  s.description    = 'Tunnel status/traffic surfacing, NetTunnelProviderManager flow, App-Group hand-off writer and bounded TCP relay probe for OpenTunnel, exposed through the Expo Modules API.'
  s.author         = 'apps-hub'
  s.homepage       = 'https://github.com/outsentia/apps-hub'
  # Constraints must be <= the app target (Podfile.properties.json defaults
  # to 15.1); the app's autolinking skips pods whose platform requirement is
  # newer than the target. The NetworkExtension target (16.0) compiles its
  # own shared contract file, it does not build this pod.
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  # Paths are podspec-relative (the proven NetlensCore pattern): this spec
  # sits in ios/, so "**/*" matches the sources next to it.
  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
