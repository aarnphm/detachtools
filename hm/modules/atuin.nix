{
  config,
  lib,
  pkgs,
  ...
}:
with lib; {
  options.atuin = {
    enable = mkOption {
      type = types.bool;
      default = false;
      description = mdDoc ''atuin configuration'';
    };
  };

  config = mkIf config.atuin.enable (mkMerge [
    {
      programs.atuin = {
        enable = true;
        package = pkgs.atuin;
        enableZshIntegration = true;
        enableBashIntegration = false;
        settings = {
          keymap_mode = "vim-insert";
          auto_sync = true;
          sync_frequency = "10m";
          style = "compact";
          history_filter = ["^gaa" "^gst" "^gcmm" "^v"];
          enter_accept = true;
        };
      };
    }
    (mkIf config.bash.enable {
      programs.bash.initExtra = mkAfter ''
        source ${pkgs.bash-preexec}/share/bash/bash-preexec.sh
        eval "$(${lib.getExe pkgs.atuin} init bash)"
        if declare -F atuin-bind >/dev/null; then
          atuin-bind -m vi-command '\C-r' atuin-search-vicmd
        fi
      '';
    })
  ]);
}
