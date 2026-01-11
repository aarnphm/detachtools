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
        systemd.enable = false;
        enableZshIntegration = true;
        settings = {
          theme =
            if config.home.sessionVariables.XDG_SYSTEM_THEME == "dark"
            then "Flexoki Dark"
            else "Flexoki Light";
          font-family = "Berkeley Mono";
          font-size = 13;
          window-inherit-font-size = true;
          window-width = 120;
          window-height = 120;
          keybind = [
            "cmd+s=new_split:left"
            "shift+cmd+s=new_split:up"
            "global:cmd+shift+grave_accent=toggle_quick_terminal"
            # entry point
            "option+v=activate_key_table:vim"
            # keytable def
            "vim/"
            # Line movement
            "vim/j=scroll_page_lines:1"
            "vim/k=scroll_page_lines:-1"
            # Page movement
            "vim/ctrl+d=scroll_page_down"
            "vim/ctrl+u=scroll_page_up"
            "vim/ctrl+f=scroll_page_down"
            "vim/ctrl+b=scroll_page_up"
            "vim/shift+j=scroll_page_down"
            "vim/shift+k=scroll_page_up"
            # Jump to top/bottom
            "vim/g>g=scroll_to_top"
            "vim/shift+g=scroll_to_bottom"
            # Search (if you want vim-style search entry)
            "vim/slash=start_search"
            "vim/n=navigate_search:next"
            # Copy mode / selection
            "vim/v=copy_to_clipboard"
            "vim/y=copy_to_clipboard"
            # Command Palette
            "vim/shift+semicolon=toggle_command_palette"
            # Exit
            "vim/escape=deactivate_key_table"
            "vim/q=deactivate_key_table"
            "vim/i=deactivate_key_table"
            # Catch unbound keys
            "vim/catch_all=ignore"
          ];
          macos-icon = "xray";
          macos-icon-frame = "chrome";
          macos-titlebar-style = "tabs";
          scrollback-limit = 51200;
          auto-update-channel = "tip";
          term = "xterm-256color";
          quick-terminal-position = "center";
          quick-terminal-size = "1080px,1080px";
          quick-terminal-screen = "mouse";
          quick-terminal-animation-duration = 0;
        };
      };
    };
  };
}
