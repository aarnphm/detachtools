{
  config,
  lib,
  ...
}:
with lib; {
  options.ghostty = {
    enable = mkOption {
      type = types.bool;
      default = false;
      description = mdDoc ''ghostty configuration'';
    };
  };

  config = mkIf config.ghostty.enable {
    programs = {
      ghostty = {
        enable = true;
        package = null;
        enableZshIntegration = true;
        settings = {
          theme =
            if config.home.sessionVariables.XDG_SYSTEM_THEME == "dark"
            then "Flexoki Dark"
            else "Flexoki Light";
          font-family = "Berkeley Mono";
          font-size = 14;
          window-inherit-font-size = true;
          window-width = 120;
          window-height = 120;
          keybind = [
            "cmd+s=new_split:left"
            "shift+cmd+s=new_split:up"
            "shift+enter=text:\n"
            "global:cmd+shift+grave_accent=toggle_quick_terminal"
          ];
          macos-icon = "xray";
          macos-icon-frame = "chrome";
          macos-titlebar-style = "tabs";
          scrollback-limit = 51200;
          auto-update-channel = "tip";
          term = "xterm-256color";
          quick-terminal-position = "center";
          quick-terminal-size = "50%,500px";
          quick-terminal-screen = "mouse";
          quick-terminal-animation-duration = 0;
        };
      };
    };
  };
}
