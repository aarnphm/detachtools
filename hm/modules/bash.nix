{
  config,
  lib,
  pkgs,
  ...
}:
with lib; let
  fzfComplete = with pkgs;
    writeProgram "fzf_complete_realpath.bash" {
      replacements = {
        bat = lib.getExe bat;
        hexyl = lib.getExe hexyl;
        tree = lib.getExe tree;
        catimg = lib.getExe catimg;
      };
      dir = ".";
    }
    ./config/fzf_complete_realpath.zsh.in;
in {
  options.bash = {
    enable = mkOption {
      type = types.bool;
      default = false;
      description = mdDoc ''Bash for remote Linux machines'';
    };
  };

  config = mkIf config.bash.enable {
    home.packages = [pkgs.bash-completion];

    programs.bash = {
      enable = true;
      historySize = 100000;
      historyFileSize = 100000;
      historyFile = "${config.home.homeDirectory}/.local/share/bash/history";
      historyControl = ["ignoredups" "erasedups"];
      shellOptions = [
        "histappend"
        "cmdhist"
        "histverify"
        "checkwinsize"
        "autocd"
        "globstar"
        "nocaseglob"
        "cdspell"
      ];
      profileExtra = ''
        if [[ -f /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh ]]; then
          source /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh
        fi

        if [[ -d /nix ]] && ! pgrep -x nix-daemon >/dev/null 2>&1; then
          sudo /nix/var/nix/profiles/default/bin/nix-daemon &>/dev/null &
          disown
        fi
      '';
      initExtra = ''
        export HISTFILE
        eval "$(${lib.getExe pkgs.oh-my-posh} init bash --config ${config.xdg.configHome}/oh-my-posh/config.toml)"

        source ${fzfComplete}/fzf_complete_realpath.bash
        source ${pkgs.bash-completion}/share/bash-completion/bash_completion
        source ${pkgs.fzf}/share/fzf/key-bindings.bash
        source ${pkgs.fzf}/share/fzf/completion.bash
        source ${pkgs.bash-dix}/share/bash/dix.plugin.bash

        [[ -d ${config.home.homeDirectory}/.ghcup ]] && source ${config.home.homeDirectory}/.ghcup/env
        [[ -d ${config.home.sessionVariables.WORKSPACE}/modular ]] && source ${config.home.sessionVariables.WORKSPACE}/modular/utils/start-modular.sh

        gcmmp() {
          set -euo pipefail

          local commitMessage="''${*:-}"
          if [[ -z "$commitMessage" ]]; then
            echo 'usage: gcmmp "fix: message"' >&2
            return 2
          fi

          ${lib.getExe pkgs.git} commit -S --signoff -svm "$commitMessage"
          ${lib.getExe pkgs.git} push
        }

        bwpassfile="${config.home.homeDirectory}/bw.pass"
        if [[ -f "$bwpassfile" ]]; then
          mapfile -t bitwarden < "$bwpassfile"
          export BW_MASTER=''${bitwarden[0]}
          export BW_CLIENTID=''${bitwarden[1]}
          export BW_CLIENTSECRET=''${bitwarden[2]}
        fi
      '';
    };
  };
}
