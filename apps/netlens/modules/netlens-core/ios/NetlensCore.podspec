Pod::Spec.new do |s|
  s.name           = 'NetlensCore'
  s.version        = '0.1.0'
  s.summary        = 'NetLens native networking engine (TCP sweep, mDNS, SSDP)'
  s.description    = 'LAN host discovery and service enrichment engine for NetLens, exposed through the Expo Modules API.'
  s.author         = 'apps-hub'
  s.homepage       = 'https://github.com/outsentia/apps-hub'
  # Constraints must be <= the app target (Podfile.properties.json defaults to 15.1);
  # app's autolink skips pods whose platform requirement is newer than the target.
  s.platforms      = {
    :ios => '15.1',
    :tvos => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
