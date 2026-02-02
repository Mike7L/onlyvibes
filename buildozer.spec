[app]

# (str) Title of your application
title = OnlyMusic

# (str) Package name
package.name = onlymusic

# (str) Package domain (needed for android/ios)
package.domain = com.onlymusic

# (str) Source code where the main.py live
source.dir = .

# (list) Source files to include (let empty to include all the files)
source.include_exts = py,png,jpg,kv,atlas,txt,json

# (str) Application versioning (method 1)
version = 0.1

# (list) Application requirements
# pyobjus is required for iOS native APIs
requirements = python3,kivy,kivymd,pyobjus,yt-dlp,requests,certifi,openssl

# (str) Presplash of the application
#presplash.filename = %(source.dir)s/data/presplash.png

# (str) Icon of the application
#icon.filename = %(source.dir)s/data/icon.png

# (str) Supported orientation (landscape, portrait or all)
orientation = portrait

# (bool) Indicate if the application should be fullscreen or not
fullscreen = 0

# iOS specific

# (str) Name of the certificate to use for signing the debug version
# Get this from your Apple Developer Account
#ios.codesign.debug = "iPhone Developer: <name> (<hash>)"

# (str) Name of the certificate to use for signing the release version
#ios.codesign.release = %(ios.codesign.debug)s

# (list) Permissions
ios.permissions = NSAppleMusicUsageDescription:Access to play music,NSMicrophoneUsageDescription:For audio playback

# (str) URL scheme for app
#ios.url_schemes = onlymusic

# Background modes for audio
ios.background_modes = audio

# Capabilities
ios.capabilities = audio

# iOS version
ios.deployment_target = 13.0

# iOS specific recipes
ios.kivy_ios_url = https://github.com/kivy/kivy-ios
ios.kivy_ios_branch = master
ios.ios_deploy_url = https://github.com/phonegap/ios-deploy
ios.ios_deploy_branch = 1.7.0

[buildozer]

# (int) Log level (0 = error only, 1 = info, 2 = debug (with command output))
log_level = 2

# (int) Display warning if buildozer is run as root (0 = False, 1 = True)
warn_on_root = 1
