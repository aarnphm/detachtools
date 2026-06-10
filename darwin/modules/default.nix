{
  config,
  lib,
  pkgs,
  ...
}: let
  defaultKernel = pkgs.stdenv.mkDerivation {
    pname = "kata-container-kernel";
    version = "3.26.0";

    outputHash = "sha256-Y+LzuhkEwPlEGDUW4xtN6sCcIELOm+3x9V18XpRA/1Y=";
    outputHashMode = "flat";

    nativeBuildInputs = with pkgs; [
      cacert
      curl
      gnutar
      zstd
    ];

    buildCommand = ''
      curl -L --fail -o kata.tar.zst "https://github.com/kata-containers/kata-containers/releases/download/$version/kata-static-$version-arm64.tar.zst"
      tar --zstd -xf kata.tar.zst ./opt/kata/share/kata-containers/
      cp -L ./opt/kata/share/kata-containers/vmlinux.container "$out"
    '';
  };

  containerSubmodule = lib.types.submodule {
    options = {
      image = lib.mkOption {
        type = lib.types.str;
        description = "Image name to run, including tag when needed.";
      };

      autoStart = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Whether to start this container with launchd.";
      };

      cmd = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [];
        description = "Command arguments appended after the image.";
      };

      env = lib.mkOption {
        type = lib.types.attrsOf lib.types.str;
        default = {};
        description = "Environment variables passed with --env.";
      };

      volumes = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [];
        description = "Volume mounts passed with --volume.";
      };

      ports = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [];
        description = "Port mappings passed with --publish.";
      };

      autoCreateMounts = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether to create absolute host paths used by volume mounts.";
      };

      entrypoint = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Entrypoint passed with --entrypoint.";
      };

      user = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Container user passed with --user.";
      };

      workdir = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Container working directory passed with --workdir.";
      };

      init = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Whether to pass --init.";
      };

      ssh = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Whether to pass --ssh.";
      };

      network = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Network passed with --network.";
      };

      readOnly = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Whether to pass --read-only.";
      };

      labels = lib.mkOption {
        type = lib.types.attrsOf lib.types.str;
        default = {};
        description = "Container labels passed with --label.";
      };

      extraArgs = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [];
        description = "Extra arguments passed to container run before the image.";
      };
    };
  };

  cfg = config.services.container;
  containerExe = lib.getExe cfg.package;
  kernelInstallFlag =
    if cfg.kernel != null
    then "--disable-kernel-install"
    else if cfg.enableKernelInstall
    then "--enable-kernel-install"
    else "--disable-kernel-install";
  startArgs =
    [
      "system"
      "start"
      kernelInstallFlag
    ]
    ++ lib.optionals (cfg.appRoot != null) ["--app-root" cfg.appRoot]
    ++ lib.optionals (cfg.installRoot != null) ["--install-root" cfg.installRoot]
    ++ lib.optionals (cfg.logRoot != null) ["--log-root" cfg.logRoot]
    ++ lib.optionals (cfg.timeout != null) ["--timeout" (toString cfg.timeout)];
  runAsUser = command: ''
    CONTAINER_UID=$(/usr/bin/id -u ${lib.escapeShellArg cfg.user} 2>/dev/null || true)
    if [ -z "$CONTAINER_UID" ]; then
      echo "container: could not resolve uid for ${cfg.user}" >&2
      exit 1
    fi
    /bin/launchctl asuser "$CONTAINER_UID" /usr/bin/sudo -u ${lib.escapeShellArg cfg.user} -- ${lib.escapeShellArgs ([containerExe] ++ command)}
  '';
  setupKernelScript = lib.optionalString (cfg.kernel != null) ''
    ${runAsUser ["system" "kernel" "set" "--binary" "${cfg.kernel}" "--force"]}
  '';
  userHome =
    if cfg.user == null
    then null
    else if builtins.hasAttr cfg.user config.users.users
    then config.users.users.${cfg.user}.home
    else "/Users/${cfg.user}";
  appRoot =
    if cfg.appRoot != null
    then cfg.appRoot
    else "${userHome}/Library/Application Support/com.apple.container";
  bootoutStaleServicesScript = ''
    CONTAINER_UID=$(/usr/bin/id -u ${lib.escapeShellArg cfg.user} 2>/dev/null || true)
    if [ -n "$CONTAINER_UID" ]; then
      for domain in "gui/$CONTAINER_UID" "user/$CONTAINER_UID"; do
        /bin/launchctl print "$domain" >/dev/null 2>&1 || continue
        /bin/launchctl print "$domain" 2>/dev/null \
          | /usr/bin/awk '$1 ~ /^[0-9]+$/ {for (i = 1; i <= NF; i++) { field = $i; gsub(/^"|"$/, "", field); if (field ~ /^com\.apple\.container\.[A-Za-z0-9_.-]+$/) { print field; break } }}' \
          | /usr/bin/sort -u \
          | while IFS= read -r label; do
              [ -n "$label" ] || continue
              service=$(/bin/launchctl print "$domain/$label" 2>/dev/null || true)
              if ! /usr/bin/printf '%s\n' "$service" | /usr/bin/grep -F ${lib.escapeShellArg "${cfg.package}"} >/dev/null; then
                echo "container: booting out stale $domain/$label"
                /bin/launchctl bootout "$domain/$label" 2>/dev/null || true
              fi
            done
      done
    fi
  '';
  removeStalePlistsScript = ''
    if [ -d ${lib.escapeShellArg appRoot} ]; then
      /usr/bin/find ${lib.escapeShellArg appRoot} -name '*.plist' -type f -print \
        | while IFS= read -r plist; do
            if ! /usr/bin/grep -F ${lib.escapeShellArg "${cfg.package}"} "$plist" >/dev/null 2>&1; then
              echo "container: removing stale service plist $plist"
              /bin/rm -f "$plist"
            fi
          done
    fi
  '';
  autoStartContainers = lib.filterAttrs (_: container: container.autoStart) cfg.containers;
  mkContainerArgs = name: container: let
    labels =
      container.labels
      // {
        managed-by = "dix";
      };
  in
    [
      containerExe
      "run"
      "--name"
      name
    ]
    ++ lib.optionals (container.entrypoint != null) ["--entrypoint" container.entrypoint]
    ++ lib.optionals (container.user != null) ["--user" container.user]
    ++ lib.optionals (container.workdir != null) ["--workdir" container.workdir]
    ++ lib.optional container.init "--init"
    ++ lib.optional container.ssh "--ssh"
    ++ lib.optional container.readOnly "--read-only"
    ++ lib.optionals (container.network != null) ["--network" container.network]
    ++ lib.concatMap (env: ["--env" env]) (lib.mapAttrsToList (name: value: "${name}=${value}") container.env)
    ++ lib.concatMap (label: ["--label" label]) (lib.mapAttrsToList (name: value: "${name}=${value}") labels)
    ++ lib.concatMap (volume: ["--volume" volume]) container.volumes
    ++ lib.concatMap (port: ["--publish" port]) container.ports
    ++ container.extraArgs
    ++ [container.image]
    ++ container.cmd;
  mkContainerScript = name: container: let
    args = mkContainerArgs name container;
  in
    pkgs.writeShellScript "container-${name}" ''
      if [ "$(/usr/bin/id -un)" != ${lib.escapeShellArg cfg.user} ]; then
        exit 0
      fi

      attempt=1
      while [ "$attempt" -le 30 ]; do
        if ${containerExe} system status >/dev/null 2>&1; then
          break
        fi
        /bin/sleep 1
        attempt=$((attempt + 1))
      done

      if ! ${containerExe} system status >/dev/null 2>&1; then
        exit 1
      fi

      ${containerExe} stop ${lib.escapeShellArg name} >/dev/null 2>&1 || true
      ${containerExe} rm ${lib.escapeShellArg name} >/dev/null 2>&1 || true
      exec ${lib.escapeShellArgs args}
    '';
  mkMountDirsScript = lib.concatStrings (
    lib.mapAttrsToList (
      name: container:
        lib.optionalString (container.autoCreateMounts && container.volumes != []) (
          lib.concatMapStrings (
            volume: let
              hostPath = builtins.head (lib.splitString ":" volume);
            in
              lib.optionalString (lib.hasInfix ":" volume && lib.hasPrefix "/" hostPath) ''
                if [ ! -d ${lib.escapeShellArg hostPath} ]; then
                  echo "container: creating mount ${hostPath} for ${name}"
                  /usr/bin/sudo -u ${lib.escapeShellArg cfg.user} /bin/mkdir -p ${lib.escapeShellArg hostPath}
                fi
              ''
          )
          container.volumes
        )
    )
    cfg.containers
  );
  containerAgents =
    lib.mapAttrs' (
      name: container: let
        label = "dev.apple.container.${name}";
      in
        lib.nameValuePair label {
          serviceConfig = {
            Label = label;
            ProgramArguments = [(toString (mkContainerScript name container))];
            RunAtLoad = true;
            KeepAlive = {
              SuccessfulExit = false;
            };
            LimitLoadToSessionType = "Background";
            StandardOutPath = "${userHome}/Library/Logs/container-${name}.log";
            StandardErrorPath = "${userHome}/Library/Logs/container-${name}.err";
          };
        }
    )
    autoStartContainers;

  # Get a list of all .nix files in the current directory
  moduleFiles =
    builtins.filter
    (f: f != "default.nix")
    (builtins.attrNames (builtins.readDir ./.));
in {
  imports = map (file: ./. + "/${file}") moduleFiles;

  options.services.container = {
    enable = lib.mkOption {
      type = lib.types.nullOr lib.types.bool;
      default = null;
      description = ''
        Whether to manage Apple's container service. Set to true to start the
        service, false to stop it, or null to leave it unmanaged.
      '';
    };

    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.container;
      defaultText = lib.literalExpression "pkgs.container";
      description = ''
        Package providing the container executable.
      '';
    };

    user = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = ''
        User account that owns and runs the container service.
      '';
    };

    enableKernelInstall = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Whether container system start should install the recommended default kernel
        when one is missing and services.container.kernel is null.
      '';
    };

    kernel = lib.mkOption {
      type = lib.types.nullOr lib.types.package;
      default = defaultKernel;
      defaultText = lib.literalExpression "pkgs.callPackage <kata-container-kernel> { }";
      description = ''
        Kernel binary installed as the Apple container default kernel. Set to null
        to let container system start install its recommended kernel at runtime.
      '';
    };

    appRoot = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "/Users/aarnphm/Library/Application Support/com.apple.container";
      description = ''
        Application data root passed as --app-root.
      '';
    };

    installRoot = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "/usr/local";
      description = ''
        Application executable and plugin root passed as --install-root.
      '';
    };

    logRoot = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = ''
        Log data root passed as --log-root.
      '';
    };

    timeout = lib.mkOption {
      type = lib.types.nullOr lib.types.ints.positive;
      default = null;
      example = 120;
      description = ''
        Seconds to wait for the container API service to respond.
      '';
    };

    dns = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Whether to configure the host resolver for container DNS.";
      };

      domain = lib.mkOption {
        type = lib.types.str;
        default = "test";
        description = "Container DNS domain.";
      };

      port = lib.mkOption {
        type = lib.types.port;
        default = 2053;
        description = "Container DNS listener port on localhost.";
      };
    };

    containers = lib.mkOption {
      type = lib.types.attrsOf containerSubmodule;
      default = {};
      description = "Declarative Apple containers keyed by container name.";
    };
  };

  config = lib.mkIf (cfg.enable != null) {
    assertions =
      [
        {
          assertion = cfg.user != null;
          message = "`services.container.user` must be set when `services.container.enable` is not null.";
        }
      ]
      ++ lib.optional (cfg.enable && cfg.user != config.system.primaryUser) {
        assertion = false;
        message = "`services.container.user` must match `system.primaryUser` because Apple container runs in the primary user's launchd domain.";
      };

    environment.systemPackages = lib.optionals cfg.enable [
      cfg.package
    ];

    environment.etc = lib.mkIf (cfg.enable && cfg.dns.enable) {
      "resolver/${cfg.dns.domain}".text = ''
        domain ${cfg.dns.domain}
        search ${cfg.dns.domain}
        nameserver 127.0.0.1
        port ${toString cfg.dns.port}
      '';
    };

    system.defaults.CustomUserPreferences = lib.mkIf (cfg.enable && cfg.dns.enable) {
      "com.apple.container.defaults" = {
        "dns.domain" = cfg.dns.domain;
      };
    };

    launchd.user.agents = lib.mkIf cfg.enable containerAgents;

    system.activationScripts.launchd.text =
      if cfg.enable
      then ''
        ${bootoutStaleServicesScript}
        ${removeStalePlistsScript}
        ${runAsUser startArgs}
        ${setupKernelScript}
        ${mkMountDirsScript}
      ''
      else runAsUser ["system" "stop"];
  };
}
