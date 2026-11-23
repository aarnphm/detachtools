{
  pkgs,
  lib,
  user,
  inputs,
  computerName,
  hostName,
  dns,
  enableSbx ? false,
  ...
}: {
  imports = [./modules];

  programs.zsh = {
    enable = true;
  };
  gpg.enable = true;

  homebrew = {
    enable = true;
    onActivation = {
      cleanup = "zap";
      extraFlags = ["--verbose"];
      autoUpdate = false;
    };
    brews =
      [
        "ast-grep"
        "gnu-tar"
        "pngpaste"
        "asciidoctor"
        "plantuml"
        "ddclient"
        "openconnect"
        "mas"
        "bitwarden-cli"
        "monolith"
        "mole"
        "rtk"
        "ripgrep"
        "gmp"
        "gnupg"
        "cargo-binstall"
      ]
      ++ lib.optionals enableSbx ["docker/tap/sbx"];
    extraConfig = ''
      brew "stripe/stripe-cli/stripe", trusted: true
    '';
    casks = [
      "google-chrome"
      "zotero"
      "discord"
      "zoom"
      "ollama-app"
      "codex"
      "chatgpt"
      "claude"
      "obsidian"
      "rectangle"
      "steam"
      "nvidia-nsight-systems"
      "karabiner-elements"
      "zed@preview"
      "zed"
      "middleclick"
    ];
    # nix run nixpkgs#mas -- search <apps>
    masApps = {
      # Bitwarden = 1352778147;
      # TestFlight = 899247664;
      # Messenger = 1480068668;
      # DaisyDisk = 411643860;
      # "WhatsApp Messenger" = 310633997;
      # "Slack for Desktop" = 803453959;
      # "NordVPN - VPN for privacy" = 905953485;
    };
  };

  # Users
  users.users.${user} = {
    shell = pkgs.zsh;
    home = "/Users/${user}";
    createHome = true;
  };

  environment = {
    shells = [pkgs.zsh];
    systemPath = ["/opt/homebrew/bin" "/opt/homebrew/sbin"];
  };

  power = {
    sleep.display = 30;
  };

  nix.settings = {
    log-lines = 20;
    keep-going = false;
    sandbox = false;
    trusted-users = [user];
    max-jobs = "auto";
    always-allow-substitutes = true;
    bash-prompt-prefix = "(nix:$name)\\040";
    experimental-features = ["nix-command" "flakes"];
    extra-nix-path = ["nixpkgs=flake:nixpkgs"];
  };

  nix = {
    enable = false;
    gc = {
      automatic = false; # NOTE: need nix.enable
      interval.Hour = 6;
      options = ''
        --delete-older-than 3d --max-freed $((128 * 1024**3 - 1024 * $(df -P -k /nix/store | tail -n 1 | ${lib.getExe' pkgs.gawk "awk"} '{ print $4 }')))
      '';
    };

    optimise = {
      automatic = false; # NOTE: need nix.enable
      interval.Hour = 6;
    };
  };

  # Networking
  networking = {
    inherit computerName hostName dns;
    knownNetworkServices = [
      "Wi-Fi"
      "Thunderbolt Ethernet Slot 2"
    ];
  };

  # add PAM
  security = {
    pam.services.sudo_local = {
      touchIdAuth = true;
      # pam-watchid needs nixpkgs Swift 6.4; swiftc-bootstrap's NixCC patch is malformed
      watchIdAuth = false;
    };
  };

  services.openssh.enable = true;
  services.container = {
    enable = true;
    inherit user;
  };

  # System preferences
  system = {
    stateVersion = 7;
    # Set Git commit hash for darwin-version.
    configurationRevision = inputs.self.rev or inputs.self.dirtyRev or null;
    primaryUser = user;

    keyboard = {
      enableKeyMapping = true;
    };

    # default settings within System Preferences
    defaults = {
      NSGlobalDomain = {
        KeyRepeat = 2;
        InitialKeyRepeat = 15;
        AppleShowAllExtensions = true;
        NSAutomaticCapitalizationEnabled = false;
        NSAutomaticSpellingCorrectionEnabled = false;
        NSAutomaticPeriodSubstitutionEnabled = false;
        NSAutomaticDashSubstitutionEnabled = false;
        NSAutomaticQuoteSubstitutionEnabled = false;
        NSAutomaticInlinePredictionEnabled = true;
      };
      dock = {
        autohide = true;
        autohide-delay = 0.0;
        magnification = true;
        mineffect = "scale";
        orientation = "bottom";
        showhidden = true;
        show-recents = false;
        mru-spaces = true;
        persistent-apps = [
          "/Applications/Claude.app"
          "/Applications/ChatGPT.app"
        ];
      };
      finder = {
        AppleShowAllFiles = true;
        AppleShowAllExtensions = true;
        # DiskImageMounter needs Finder running to show installer volumes.
        QuitMenuItem = false;
        FXEnableExtensionChangeWarning = false;
        ShowPathbar = true;
        FXPreferredViewStyle = "Nlsv"; # list view
        _FXShowPosixPathInTitle = true;
      };
      trackpad = {
        Clicking = true;
        TrackpadRightClick = true;
        TrackpadThreeFingerDrag = true;
      };
      WindowManager = {
        EnableTiledWindowMargins = true;
        EnableTilingByEdgeDrag = false;
        EnableTilingOptionAccelerator = false;
        EnableTopTilingByEdgeDrag = false;
      };
      screencapture.location = "~/Downloads";
      CustomUserPreferences = {
        "com.knollsoft.Rectangle" = {
          SUEnableAutomaticChecks = true;
          SUHasLaunchedBefore = true;
          allowAnyShortcut = true;
          almostMaximize = {
            keyCode = 8;
            modifierFlags = 786432;
          };
          almostMaximizeHeight = 0.0;
          almostMaximizeWidth = 0.0;
          altThirdCycle = 0;
          alternateDefaultShortcuts = false;
          alwaysAccountForStage = 0;
          applyGapsToMaximize = 0;
          applyGapsToMaximizeHeight = 0;
          attemptMatchOnNextPrevDisplay = 0;
          autoMaximize = 0;
          bottomHalf = {
            keyCode = 38;
            modifierFlags = 786432;
          };
          bottomLeft = {
            keyCode = 45;
            modifierFlags = 786432;
          };
          bottomRight = {
            keyCode = 46;
            modifierFlags = 786432;
          };
          cascadeAllDeltaSize = 30.0;
          center = {};
          centerHalf = {
            keyCode = 0;
            modifierFlags = 786432;
          };
          centerHalfCycles = 0;
          centerThird = {
            keyCode = 32;
            modifierFlags = 786432;
          };
          centeredDirectionalMove = 0;
          cornerSnapAreaSize = 20.0;
          curtainChangeSize = 0;
          doubleClickTitleBar = 3;
          doubleClickTitleBarRestore = 0;
          dragFromStage = 0;
          firstFourth = {
            keyCode = 23;
            modifierFlags = 1835008;
          };
          firstThird = {
            keyCode = 16;
            modifierFlags = 786432;
          };
          firstThreeFourths = {
            keyCode = 25;
            modifierFlags = 786432;
          };
          firstTwoThirds = {
            keyCode = 31;
            modifierFlags = 786432;
          };
          footprintAlpha = 0.3;
          footprintAnimationDurationMultiplier = 0.75;
          footprintBorderWidth = 2.0;
          footprintFade = 0;
          gapSize = 6.0;
          greenButtonOverride = true;
          halvesPreserveOtherAxisSize = false;
          hapticFeedbackOnSnap = 1;
          hideMenubarIcon = false;
          horizontalSplitRatio = 50.0;
          ignoreDragSnapToo = 0;
          ignoredSnapAreas = 0;
          internalTilingNotified = true;
          landscapeSnapAreas = ''[1,{"action":15},5,{"compound":-3},2,{"action":2},6,{"action":13},3,{"action":16},4,{"compound":-2},8,{"action":14},7,{"compound":-4}]'';
          larger = {
            keyCode = 24;
            modifierFlags = 786432;
          };
          lastFourth = {
            keyCode = 28;
            modifierFlags = 1835008;
          };
          lastThird = {
            keyCode = 34;
            modifierFlags = 786432;
          };
          lastThreeFourths = {
            keyCode = 29;
            modifierFlags = 786432;
          };
          lastTwoThirds = {
            keyCode = 35;
            modifierFlags = 786432;
          };
          lastVersion = "111";
          launchOnLogin = true;
          leftHalf = {
            keyCode = 4;
            modifierFlags = 786432;
          };
          maximize = {
            keyCode = 36;
            modifierFlags = 786432;
          };
          minimumWindowHeight = 0.0;
          minimumWindowWidth = 0.0;
          missionControlDragging = 0;
          missionControlDraggingAllowedOffscreenDistance = 25.0;
          missionControlDraggingDisallowedDuration = 250;
          moveCursor = 0;
          moveCursorAcrossDisplays = 1;
          moveDown = {
            keyCode = 40;
            modifierFlags = 1835008;
          };
          moveLeft = {
            keyCode = 4;
            modifierFlags = 1835008;
          };
          moveRight = {
            keyCode = 37;
            modifierFlags = 1835008;
          };
          moveUp = {
            keyCode = 38;
            modifierFlags = 1835008;
          };
          nextDisplay = {
            keyCode = 124;
            modifierFlags = 917504;
          };
          notifiedOfProblemApps = true;
          obtainWindowOnClick = 0;
          previousDisplay = {
            keyCode = 123;
            modifierFlags = 917504;
          };
          reflowTodo = {
            keyCode = 45;
            modifierFlags = 786432;
          };
          relaunchOpensMenu = false;
          resizeOnDirectionalMove = false;
          rightHalf = {
            keyCode = 37;
            modifierFlags = 786432;
          };
          screenEdgeGapBottom = 0.0;
          screenEdgeGapLeft = 0.0;
          screenEdgeGapRight = 0.0;
          screenEdgeGapTop = 0.0;
          screenEdgeGapsOnMainScreenOnly = false;
          secondFourth = {
            keyCode = 22;
            modifierFlags = 1835008;
          };
          shortEdgeSnapAreaSize = 145.0;
          showAdditionalSizesInMenu = 2;
          showAllActionsInMenu = 0;
          sixthsSnapArea = 0;
          sizeOffset = 0.0;
          smaller = {
            keyCode = 27;
            modifierFlags = 786432;
          };
          snapEdgeMarginBottom = 5.0;
          snapEdgeMarginLeft = 5.0;
          snapEdgeMarginRight = 5.0;
          snapEdgeMarginTop = 5.0;
          snapModifiers = 0;
          specifiedHeight = 1050.0;
          specifiedWidth = 1680.0;
          stageSize = 135.3125;
          subsequentExecutionMode = 1;
          systemWideMouseDown = 0;
          thirdFourth = {
            keyCode = 26;
            modifierFlags = 1835008;
          };
          todo = 2;
          todoMode = false;
          todoSidebarWidth = 400.0;
          toggleTodo = {
            keyCode = 11;
            modifierFlags = 786432;
          };
          topHalf = {
            keyCode = 40;
            modifierFlags = 786432;
          };
          topLeft = {
            keyCode = 11;
            modifierFlags = 786432;
          };
          topRight = {
            keyCode = 43;
            modifierFlags = 786432;
          };
          traverseSingleScreen = 0;
          unsnapRestore = 0;
          verticalSplitRatio = 66.66667;
          windowSnapping = 1;
        };
      };
    };
  };
}
