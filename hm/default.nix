{
  config,
  pkgs,
  lib,
  inputs,
  user,
  ...
}: let
  filterNone = value: builtins.filter (x: x != null) value;
  fhPackage = inputs.fh.packages.${pkgs.stdenv.hostPlatform.system}.default;
  packages = with pkgs; [
    # editor
    vim
    # gvim
    bun
    uv
    ty
    lua

    # kubernetes and container
    kubectl
    buildkit
    qemu
    ratchet
    kind
    skopeo
    buildifier
    awscli2
    atuin
    just
    nodejs_24
    go-task

    # git
    git
    git-lfs
    delta
    tree

    # languages
    go
    protobuf
    pnpm
    zulu17
    xz
    age
    eternal-terminal
    elan
    zig

    # tools for language, lsp, linter, etc.
    grpcurl
    taplo
    stylua
    selene
    protolint
    buf
    sqlite
    postgresql_14
    llvm_18
    openblas
    enchant
    python313Packages.pylatexenc
    pastel
    pscale

    # terminal
    any-nix-shell
    zsh-completions
    fhPackage
    curl
    jq
    yq-go
    gh
    btop
    zip
    pstree
    eza
    zoxide
    rm-improved
    mmv
    fd
    dust
    duf
    broot
    fzf
    bat
    sd
    procs
    xh
    mupdf
    ripgrep
    hexyl
    catimg
    watch
    ffmpeg
    dtach
    zstd
    gnused
    cmake
    wget
    gzip
    hyperfine
    gnupg
    gpg-tui
    gnumake
    alejandra
    ueberzugpp
    google-cloud-sdk
    ninja
    buildkite-cli
    cloudflared

    # packages overlays
    git-forest
    unicopy
    lambda
    nebius
    worktree-manager
  ];
  darwinPackages = with pkgs; [
    # for some reason they don't have flock on darwin :(
    undmg
    xar
    cpio
    mas
    imagemagick
    texliveFull
    ghostscript
    container
    # apps
    pinentry_mac
    pinentry-touchid
  ];
  linuxPackages = with pkgs; [
    colima
    lima
    pinentry-all
    # NOTE: on darwin we need to use Apple provided from xcrun
    coreutils-full
  ];

  sessionVariables = let
    inherit (pkgs) fd git neovim ripgrep zsh;
    inherit (lib) concatStringsSep getExe makeBinPath;
    defaultShell = zsh;
  in
    {
      # XDG
      XDG_BIN_HOME = "${config.home.homeDirectory}/.local/bin";

      # bentoml
      BENTOML_HOME = "${config.home.sessionVariables.XDG_DATA_HOME}/bentoml";
      BENTOML_DO_NOT_TRACK = "True";
      BENTOML_BUNDLE_LOCAL_BUILD = "True";

      UV_NO_PROGRESS = 1;
      PNPM_HOME = "${config.home.sessionVariables.XDG_BIN_HOME}";

      # Editors
      WORKSPACE = "${config.home.homeDirectory}/workspace";
      GARDEN = "${config.home.sessionVariables.WORKSPACE}/garden";
      TABFS = "${config.home.sessionVariables.WORKSPACE}/TabFS/fs/mnt";
      SHELL = getExe defaultShell;
      MANPAGER = "${getExe neovim} +Man!";
      DISABLE_CHDIR = "1";
      WORKTREE_BRANCH_PREFIX = "aarnphm";
      CLAUDE_CODE_NO_FLICKER = "1";
      CLAUDE_CODE_AUTO_COMPACT_WINDOW = 256000;

      # Fzf
      FZF_CTRL_T_COMMAND = "${getExe fd} --hidden --follow --exclude .git";
      FZF_DEFAULT_COMMAND = let
        gitCheck = "${getExe git} rev-parse --is-inside-work-tree > /dev/null 2>&1";
        rgFiles = "${getExe ripgrep} --files --hidden";
      in "${gitCheck} && ${rgFiles} --ignore .git || ${rgFiles}";
      FZF_TMUX_HEIGHT = "70%";
      FZF_DEFAULT_OPTS_FILE = "${config.home.homeDirectory}/.fzfrc";

      # Language
      GOPATH = "${config.home.homeDirectory}/go";
      PATH = concatStringsSep ":" [
        (makeBinPath [
          "${config.home.homeDirectory}/.cargo"
          "${config.home.homeDirectory}/.wasmtime"
          pkgs.protobuf
          "${config.home.homeDirectory}/.local"
          "/opt/homebrew/opt/ruby"
          "/opt/zerobrew/prefix"
          "${config.home.homeDirectory}/.opencode"
        ])
        "$PATH"
      ];
    }
    // lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin {
      # misc
      OPENBLAS = "${lib.makeLibraryPath [pkgs.openblas]}/libopenblas.dylib";
    }
    // lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux
    {
      GPG_TTY = "$(tty)";
      UCX_TLS = "all";
      UCX_NET_DEVICES = "all";
      MODULAR_NIXL_PLUGIN_DIR = "${config.home.sessionVariables.WORKSPACE}/modular/bazel-bin/MLRT/Driver";
    };

  tomlFormat = pkgs.formats.toml {};

  gpgTuiConfig = {
    general = {
      detail_level = "full";
    };
    gpg = {
      armor = true;
    };
  };
in {
  imports = [./modules];

  bat.enable = true;
  broot.enable = true;
  btop.enable = true;
  direnv.enable = true;
  git.enable = true;
  ghostty.enable = true;
  gpg.enable = true;
  ssh.enable = false;
  tmux.enable = true;
  zsh.enable = true;
  bash.enable = false;
  atuin.enable = true;
  zoxide.enable = true;
  neovim.enable = true;
  opam.enable = pkgs.stdenv.hostPlatform.isDarwin;
  oh-my-posh.enable = true;

  # include neovim and vimrc symlinks
  xdg = {
    enable = true;
    configFile = {
      "gpg-tui/gpg-tui.toml".source = tomlFormat.generate "gpg-tui-config" gpgTuiConfig;
      "karabiner/karabiner.json" = {
        source = ./modules/config/karabiner/karabiner.json;
        force = true;
      };
      "zed/keymap.json".source = ./modules/config/zed/keymap.json;
      "zed/settings.json".source = ./modules/config/zed/settings.json;
    };
  };

  editorconfig = {
    enable = true;
    settings = {
      "*" = {
        end_of_line = "lf";
        charset = "utf-8";
        trim_trailing_whitespace = true;
        indent_style = "space";
        indent_size = 2;
        max_line_width = 119;
      };
      "/node_modules/*" = {
        indent_size = "unset";
        indent_style = "unset";
      };
      "{package.json,.travis.yml,.eslintrc.json}" = {
        indent_style = "space";
      };
    };
  };

  home = {
    inherit sessionVariables;
    packages =
      filterNone
      (packages
        ++ (lib.optionals pkgs.stdenv.hostPlatform.isDarwin ([pkgs.opam] ++ darwinPackages))
        ++ (lib.optionals pkgs.stdenv.hostPlatform.isLinux linuxPackages));
    username = user;
    homeDirectory = pkgs.lib.mkForce (
      if user == "root"
      then "/root"
      else if pkgs.stdenv.hostPlatform.isLinux
      then "/home/${user}"
      else "/Users/${user}"
    );
    stateVersion = "26.05";

    file =
      {
        ".fzfrc".text = ''
          --bind='ctrl-/:toggle-preview'
          --bind='ctrl-u:preview-page-up'
          --bind='ctrl-d:preview-page-down'
          --preview-window 'right:40%:wrap'
          --cycle --bind 'tab:toggle-up,btab:toggle-down' --prompt='» ' --marker='»' --pointer='◆' --info=right --layout='reverse' --border='sharp' --preview-window='border-sharp' --height='80%'
        '';
        ".bazelrc".text = ''
          # Share downloaded external dependencies across all workspaces
          common --repository_cache=${config.home.sessionVariables.XDG_CACHE_HOME}/bazel-repo-cache

          # Share build artifacts via local disk cache (content-addressable, concurrent-safe)
          common --disk_cache=~/.cache/bazel-disk-cache

          # Use hardlinks for repository cache to save space (APFS-friendly)
          common --experimental_repository_cache_hardlinks

          # Reduce idle server timeout (default 3 hours is too long for multi-worktree)
          startup --max_idle_secs=900

          # Disk cache garbage collection
          common --experimental_disk_cache_gc_max_size=30G
          common --experimental_disk_cache_gc_max_age=14d
        '';
      }
      // lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin {
        "/Library/Application Support/gpg-tui/gpg-tui.toml".source = tomlFormat.generate "gpg-tui-config" gpgTuiConfig;
      };

    # shells related
    shellAliases =
      {
        reload = "exec -l $SHELL";
        afk = "pmset displaysleepnow";
        ".." = "__zoxide_z ..";
        "..." = "..;..";
        "...." = "...;..";
        "....." = "....;..";
        "......" = ".....;..";

        # ls-replacement
        ls = lib.getExe pkgs.eza;
        ll = "${lib.getExe pkgs.eza} -Ml --almost-all --group-directories-first -sName --icons=always";
        mtree = "${lib.getExe pkgs.eza} --almost-all -Ml --group-directories-first --tree";
        tree = ''${lib.getExe pkgs.broot} $@'';

        # safe rm
        rm = "${lib.getExe pkgs.rm-improved} --graveyard ${config.home.homeDirectory}/.local/share/Trash";

        # ai
        cl1m = ''cl "opus[1m]"'';
        ge = "agy --dangerously-skip-permissions";
        ch = "codex --dangerously-bypass-approvals-and-sandbox";
        chat = "codex --dangerously-bypass-approvals-and-sandbox -m gpt-5.6-sol -c model_context_window=1000000 -c model_auto_compact_token_limit=900000";
        o = "opencode";
        ki = "kimi --thinking --yolo";
        auto-commit = ''argon --stream-format human --flash --conversation e7e9b4b6-b734-4927-a9a0-05927db22cb2 "now look at the current staged files, and with all of the changes from both Argon/Gemini Flash, Astra/Sol, and Opus/Haiku/Sonnet, Grok 4.7/Composer please write atomic commits following conventional commits for better history tracking here"'';

        # git
        g = lib.getExe pkgs.git;
        gcl = "${lib.getExe pkgs.gh} repo clone";
        ga = "${lib.getExe pkgs.git} add";
        gaa = "${lib.getExe pkgs.git} add .";
        gsw = "${lib.getExe pkgs.git} switch";
        gcm = "${lib.getExe pkgs.git} commit -S --signoff -sv";
        gcmm = "${lib.getExe pkgs.git} commit -S --signoff -svm";
        gcma = "${lib.getExe pkgs.git} commit -S --signoff -sv --amend";
        gcman = "${lib.getExe pkgs.git} commit -S --signoff -sv --amend --no-edit";
        grpo = "${lib.getExe pkgs.git} remote prune origin";
        grpu = "${lib.getExe pkgs.git} remote prune upstream";
        grst = "${lib.getExe pkgs.git} restore";
        grsts = "${lib.getExe pkgs.git} restore --staged";
        gst = "${lib.getExe pkgs.git} status";
        gsi = "${lib.getExe pkgs.git} status --ignored";
        gsm = "${lib.getExe pkgs.git} status -sb";
        gfom = "${lib.getExe pkgs.git} fetch origin main";
        gfum = "${lib.getExe pkgs.git} fetch upstream main";
        grfh = "${lib.getExe pkgs.git} rebase FETCH_HEAD --autosquash --ff";
        grifh = "${lib.getExe pkgs.git} rebase -i FETCH_HEAD --autosquash";
        grb = "${lib.getExe pkgs.git} rebase -i -S --signoff";
        gra = "${lib.getExe pkgs.git} rebase --abort";
        grc = "${lib.getExe pkgs.git} rebase --continue";
        gri = "${lib.getExe pkgs.git} rebase -i";
        gcp = "${lib.getExe pkgs.git} cherry-pick --gpg-sign --signoff";
        gcpa = "${lib.getExe pkgs.git} cherry-pick --abort";
        gcpc = "${lib.getExe pkgs.git} cherry-pick --continue";
        gp = "${lib.getExe pkgs.git} pull";
        gpu = "${lib.getExe pkgs.git} push";
        gpuf = "${lib.getExe pkgs.git} push --force-with-lease";
        gsts = "${lib.getExe pkgs.git} stash";
        gsp = "${lib.getExe pkgs.git} stash pop";
        gckb = "${lib.getExe pkgs.git} checkout -b";
        gck = "${lib.getExe pkgs.git} checkout";
        gdf = "${lib.getExe pkgs.git} diff";
        gb = "${lib.getExe pkgs.git} branches";
        gbd = "${lib.getExe pkgs.git} branch -D";
        gprc = "${lib.getExe pkgs.gh} pr create";
        sync-upstream = "${lib.getExe pkgs.git} fetch upstream main && ${lib.getExe pkgs.git} rebase FETCH_HEAD --autosquash --ff && ${lib.getExe pkgs.git} push";
        merge-upstream = "${lib.getExe pkgs.git} fetch upstream main && ${lib.getExe pkgs.git} merge FETCH_HEAD --ff && ${lib.getExe pkgs.git} push";

        # editor
        v = lib.getExe config.programs.neovim.finalPackage;
        vi = lib.getExe pkgs.vim;
        f = ''${lib.getExe pkgs.fd} --type f --hidden --exclude .git | ${lib.getExe pkgs.fzf} --preview "_fzf_complete_realpath {}" | xargs ${lib.getExe pkgs.neovim}'';

        # general
        cx = "chmod +x";
        cdx = "chmod -x";
        copy = lib.getExe pkgs.unicopy;
        sso-mxserv = "${lib.getExe pkgs.awscli2} sso login --profile stage-1-mxserv-admin && export AWS_PROFILE=stage-1-mxserv-admin";

        # aliases
        pip = ''${lib.getExe pkgs.uv} pip'';
        k = lib.getExe pkgs.kubectl;
        cat = lib.getExe pkgs.bat;
        jupytertext = ''${lib.getExe' pkgs.uv "uvx"} jupytertext'';
        ipynb = ''${lib.getExe' pkgs.uv "uvx"} --from 'jupyter_core' jupyter notebook --autoreload --debug'';
        ipy = "ipython --autoindent";
        pinentry = lib.getExe (
          if pkgs.stdenv.hostPlatform.isDarwin
          then pkgs.pinentry_mac
          else pkgs.pinentry-all
        );
        ghostty =
          if pkgs.stdenv.hostPlatform.isDarwin
          then ''$GHOSTTY_BIN_DIR/ghostty''
          else "poggers";

        # useful
        bwpass = ''[[ -f ${config.home.homeDirectory}/bw.master ]] && cat ${config.home.homeDirectory}/bw.master | sed -n 1p | ${lib.getExe pkgs.unicopy}'';
        unlock-vault = ''bw unlock --check &>/dev/null || export BW_SESSION=''${BW_SESSION:-"$(bw unlock --passwordenv BW_MASTER --raw)"}'';
        generate-password = "bw generate --special --uppercase --minSpecial 12 --length 80 | ${lib.getExe pkgs.unicopy}";
        lock-workflow = ''RATCHET_EXP_KEEP_NEWLINES=true ${lib.getExe pkgs.fd} -H -t f -e yml -e yaml . .github --exec-batch ${lib.getExe pkgs.ratchet} update'';
        get-redirect = ''${lib.getExe pkgs.curl} -Ls -o /dev/null -w %{url_effective} $@'';
        gpgpass = ''bw get notes gpg-personal-keys | ${lib.getExe pkgs.unicopy}'';
        sshpass = ''bw get notes gpg-age-ssh-key | ${lib.getExe pkgs.unicopy}'';

        # nix-commands
        ncg = "nix-collect-garbage -d";
        nsp = "nix-shell --pure";
        nstr = "nix-store --gc --print-roots";

        python-format = ''ruff format --config "indent-width=2" --config "line-length=119" --config "preview=true"'';
      }
      // lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin {
        obsidian = "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
      };
  };
}
