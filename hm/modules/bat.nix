{
  config,
  lib,
  pkgs,
  ...
}:
with lib; {
  options.bat = {
    enable = mkOption {
      type = types.bool;
      default = false;
      description = mdDoc ''bat configuration'';
    };
  };

  config = mkIf config.bat.enable {
    programs = {
      bat = {
        enable = true;
        config = {
          theme = "auto";
          theme-dark = "gruvbox-dark";
          theme-light = "gruvbox-light";
          map-syntax = [
            ".ignore:Git Ignore"
            "config:Git Config"
            "${config.xdg.configHome}/ghostty/config:Ghostty Config"
          ];
          pager = "${lib.getExe pkgs.less} --RAW-CONTROL-CHARS --quit-if-one-screen --mouse";
        };
      };
    };
  };
}
