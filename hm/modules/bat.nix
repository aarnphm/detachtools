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
          theme =
            if config.home.sessionVariables.XDG_SYSTEM_THEME == "dark"
            then "gruvbox-dark"
            else "gruvbox-light";
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
