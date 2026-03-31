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
        flags = ["--disable-up-arrow"];
        enableZshIntegration = true;
        enableBashIntegration = true;
        settings = {
          keymap_mode = "vim-insert";
          auto_sync = true;
          sync_frequency = "30m";
          style = "compact";
          history_filter = ["^gaa" "^gst" "^gcmm"];
          enter_accept = true;
        };
      };
    }
    (mkIf config.bash.enable {
      programs.bash.initExtra = mkAfter ''
        if [[ $- == *i* ]] && declare -F atuin-bind >/dev/null; then
          atuin-bind -m vi-command '\C-r' atuin-search-vicmd
        fi
      '';
    })
  ]);
}
