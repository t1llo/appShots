export const HELP = `appshots: capture an app's screens and sync them with an appShots server.
An app is captured where it runs, whatever it is built with: in the iOS Simulator or on a plugged-in
iPhone or iPad ('appshots capture'), in a window on this Mac ('appshots capture --mac <app>'), or as a
web app in a browser ('appshots capture --web <address>'). 'appshots run' builds and starts an Xcode
project; an app made with Flutter, React Native, Expo, Capacitor, Tauri, Electron or a web framework is
started by that toolkit's own command, and 'appshots check' says which.

  appshots setup <url> [--agent <agent>] Everything in one go: save the token, install the appshots skill
                                         and this CLI, connect the agent. Agents: claude (the default),
                                         codex, opencode, pi, other. --token <token> skips the question
  appshots login <url>                   Save the server URL and token only (asks for the token, or
                                         takes it from --token <token> or APPSHOTS_TOKEN)
  appshots update                        Bring the installed skill and this CLI up to date with the
                                         server's. Needs no token and leaves the agent's connection alone
  appshots check                         Report what is there: the server, whether the skill is current,
                                         the project in this folder and what it is made with, Xcode,
                                         simulators, the apps installed on them, and devices. Each line
                                         says what to do next
  appshots projects                      List projects on the server
  appshots run [options] [-- <args>]     Build the app in this folder and launch it in a simulator
      --scheme <name>                      Scheme to build (only when the choice is not obvious)
      --project <path>                     Workspace or project to build (only when there are several)
      --fresh                              Build in a folder of its own instead of reusing Xcode's build
      --ipad                               On the 13-inch iPad Pro instead of the iPhone Pro Max
      --duo                                On the iPhone Duo instead
      --sim <name|udid>                    On this simulator instead; it is booted if need be
      --create                             Create the simulator of the store's size when none is
                                           installed and this Xcode has the model
      --dark, --light                      Set the simulator's appearance before launching
      --lang <code>                        Launch in this language, such as de or pt-BR. A screenshot
                                           taken with --capture is filed under it in the project
      --capture <name>                     Then take the screenshot as well, as capture --clean does
      --to <project>                       Upload that screenshot to this project. It is --to here and
                                           on launch, because run's --project is the Xcode one
      --wait <seconds>                     Time the app gets to settle before --capture (default: until
                                           the screen stops changing, four seconds at most)
      -- <launch arguments>                Handed to the app as they are, such as: -- -appshots stats
  appshots launch <bundle id> [options] [-- <launch arguments>]
                                         Start an installed app again without building, to switch screen
                                         or language. Options as for run: --sim, --dark, --light, --lang,
                                         --capture, --to, --wait. That makes one screen one command:
                                         appshots launch <bundle id> --capture stats --to <project> -- -appshots stats
  appshots boot [--ipad|--duo|--sim <name|udid>] [--create]
                                         Boot the simulator the store sizes ask for and print its udid,
                                         for an app its own toolkit starts: flutter run -d <udid>,
                                         npx expo run:ios --device <udid>, npx cap run ios --target <udid>
  appshots simctl <arguments...>         Run xcrun simctl with the right Xcode: openurl, ui, privacy, push
  appshots devices                       List booted simulators and connected devices
  appshots capture [options]             Take a screenshot
      --name <name>                        Screenshot name slides refer to (default: timestamp)
      --sim [name|udid]                    From a booted simulator (the default source)
      --device [name|udid]                 From a connected, unlocked iPhone or iPad (Xcode 27+)
      --mac <app>                          From a Mac app running on this Mac: its frontmost window,
                                           without the shadow. A window is shown as a window, an app
                                           in full screen inside a MacBook. The terminal needs the
                                           Screen Recording permission in System Settings
      --web <address>                      From a web app: the page at this address, drawn by Chrome
                                           without a window, at the size of an iPhone. --as ipad,
                                           --as duo or --as mac draws it at that size. On a phone or
                                           tablet the top is left free for the status bar and the
                                           home indicator is drawn. With it:
        --dark, --light                      The colour scheme the page is asked for
        --wait <seconds>                     Time the page gets to settle once loaded (default: 1)
        --init <script|@file>                JavaScript run before the page's own on every load:
                                             sample data in localStorage, a fixed date
        --eval <script|@file>                JavaScript run in the loaded page before the picture:
                                             the click or scroll that brings up the screen
        --viewport <width>x<height>          The page's size in points instead of the device's
        --profile <dir>                      Keep cookies and storage in this folder between captures
        --user-agent <text>                  The browser the page is told it is in. Left out, Safari
                                             on that device, or Chrome for --as mac
      --clean                              Simulator only: show 9:41, full battery and signal
      --project <id>                       Upload it to this project straight away (--to works too)
      --as <iphone|duo|ipad|mac>           File it under this device. Only needed when the server
                                           cannot tell from the size; upload, run and launch take it too
      --lang <code>                        It shows the app in this language, one the project has.
                                           Left out, it is for the project's first language, which
                                           every other language shows until it has its own
      --out <dir>                          Where to save the PNG (default: ./raw-shots)
  appshots shoot <project> <names...>    For a person at the Terminal: names each screen in turn, waits
                                         for Return while you open it, then captures and uploads it.
                                         Options as for capture: --sim, --device, --mac, --clean, --out,
                                         --lang
  appshots upload <project> <files or folders...>
                                         Upload screenshots that exist already. A folder stands for the
                                         PNG and JPEG files in it. The name is the file name, or --name
                                         for a single file
      --lang <code>                        They show the app in this language, as for capture
      --image                              They are not screenshots but a logo or other artwork for the
                                           slides: PNG, SVG, JPEG or WebP, transparency kept
  appshots pull <project> [--out <dir>]  Download the rendered screenshots, the header and search
                                         results assets and the banners (--render renders first)
  appshots mockups <project> [options]   Download every screenshot inside its device with nothing behind
                                         it: one transparent PNG each, for a website or a README. Needs
                                         no slides and uses no render
      --out <dir>                          Where to put them (default: ./mockups/<project>)
      --lang <code>                        Only this language's. Left out: the first language's, and a
                                           folder per other language for the screenshots it has of its own
      --style <real|clay|outline|sketch>   How the device is drawn. This and the next ones are saved
      --color <colour>                     with the project, so the Studio's Mockups page shows the same:
      --shadow <none|soft|strong>          black, silver, natural, gold, blue or orange; a shadow under
      --rotate <degrees>                   the device; its tilt, such as -8; a 3D turn to the left or
      --perspective <none|left|right>      right; a clean status bar (none, cover or overlay) and the
      --status-bar <kind>, --time <9:41>   time it shows; and --frame none for the bare screenshot
      --width <pixels>                     Width of each PNG. auto, the default, shows the screenshot
                                           pixel for pixel
  appshots store <command>               Put a finished set into App Store Connect from this Mac, with an
                                         API key of your own. The key file stays where it is: only its
                                         path is saved, and neither goes to the appShots server. Nothing
                                         is ever submitted for review or released
      login --issuer <issuer id> --key-id <key id> --key <path to the .p8 file>
                                           Save the three and check them with Apple. A key with the
                                           role Marketing is enough. Without --key, AuthKey_<key id>.p8
                                           is looked for in ~/.appstoreconnect/private_keys
      apps                                 List the apps the key reaches, with their bundle ids
      push <project> --app <bundle id>     Upload the project's screenshots: each language into its
                                           language, each folder onto its display, in place of what is
                                           there. They go into the version being prepared
        --version <number>                   Create that version when none is being prepared
        --render                             Render first, as pull --render does
        --from <folder>                      Take the files of an earlier 'appshots pull' instead
        --lang <codes>                       Only these languages, such as de-DE,fr-FR. en=en-GB puts
                                             the files of en onto the store's en-GB
        --only <devices or folders>          Only these, such as iphone,ipad or iphone-6.9,ipad-13
        --add-languages                      Add a language the store page does not have yet
        --dry-run                            Change nothing and say what would be done
      text --app <bundle id>               Print the store page's texts per language as JSON: name,
                                           subtitle, description, keywords, promotionalText, whatsNew,
                                           supportUrl, marketingUrl
        --set '<JSON>' | @file.json | -      Write the ones given, in that same shape. Takes --version,
                                             --add-languages and --dry-run as push does
        --platform <ios|mac>                 Which version's texts, for an app that has both
  appshots open [project]                Open the Studio in the browser
  appshots tools [tool]                  List the server's tools, or one tool's arguments
  appshots call <tool> [arguments]       Call one. Arguments are JSON: inline, @file.json, or - for stdin
                                         (--out <dir> is where returned pictures are saved)
  appshots clean --builds [--older-than <days>] [--dry-run]
                                         Remove the build logs and --fresh builds 'appshots run' keeps
                                         in ~/Library/Caches/appshots, or only those of projects not
                                         built for that many days

Server and token come from APPSHOTS_URL / APPSHOTS_TOKEN, or from 'appshots setup' or 'appshots login'.
The token is a personal one from Connect in the Studio. The App Store Connect key comes from
'appshots store login', or from ASC_ISSUER_ID, ASC_KEY_ID and ASC_KEY_PATH.`;
