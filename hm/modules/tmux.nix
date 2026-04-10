{
  config,
  lib,
  ...
}:
with lib; let
  terminalTheme = import ../lib/terminal-theme.nix {inherit config;};
  inherit (terminalTheme) bar;
in {
  options.tmux = {
    enable = mkOption {
      type = types.bool;
      default = false;
      description = mdDoc ''tmux configuration'';
    };
  };

  config = mkIf config.tmux.enable {
    programs.tmux = {
      enable = true;
      clock24 = true;
      escapeTime = 0;
      focusEvents = true;
      historyLimit = 50000;
      keyMode = "vi";
      mouse = true;
      prefix = "C-b";
      terminal = "tmux-256color";
      extraConfig = ''
        bind-key n last-window
        bind-key m send-prefix
        bind-key h split-window -hb -c "#{pane_current_path}"
        bind-key j split-window -v -c "#{pane_current_path}"
        bind-key k split-window -vb -c "#{pane_current_path}"
        bind-key l split-window -h -c "#{pane_current_path}"
        bind-key '"' split-window -v -c "#{pane_current_path}"
        bind-key % split-window -h -c "#{pane_current_path}"
        bind-key c new-window -c "#{pane_current_path}"

        set -g status-position bottom
        set -g status-justify left
        set -g status-interval 1
        set -g status-left ""
        set -g status-left-length 0
        set -g status-right '#{?client_prefix,#[fg=${bar.prefixForeground},bg=${bar.prefixBackground},bold] prefix #[default],}#[fg=${bar.clockDateForeground},bg=${bar.clockDateBackground},bold] %Y-%m-%d #[fg=${bar.clockTimeForeground},bg=${bar.clockTimeBackground},bold] %H:%M:%S '
        set -g status-right-length 64
        set -g status-style "bg=${bar.background},fg=${bar.mutedForeground}"
        set -g window-status-separator ""
        set -g message-style "fg=${bar.messageForeground},bg=${bar.messageBackground},bold"
        set -g message-command-style "fg=${bar.messageForeground},bg=${bar.messageBackground},bold"
        set -g mode-style "fg=${bar.modeForeground},bg=${bar.modeBackground},bold"
        set -g pane-border-style "fg=${bar.inactiveBorder}"
        set -g pane-active-border-style "fg=${bar.activeBorder}"
        set -g display-panes-active-colour "${bar.accentB}"
        set -g display-panes-colour "${bar.accentA}"
        set -s set-clipboard on
        set -as terminal-features ",xterm-256color:RGB,tmux-256color:RGB,screen-256color:RGB,ghostty:RGB"

        setw -g automatic-rename on
        setw -g window-status-bell-style "fg=${bar.foreground},bg=${bar.accentA},bold"
        setw -g window-status-current-format '#[fg=${bar.foreground},bg=${bar.currentWindowBackground},bold] #I#[fg=${bar.accentB},bg=${bar.currentWindowBackground}] : #[fg=${bar.currentWindowForeground},bg=${bar.currentWindowBackground}]#W#{?window_flags,#[fg=${bar.accentA},bg=${bar.currentWindowBackground}] #F,} #[default]'
        setw -g window-status-format '#[fg=${bar.foreground},bg=${bar.mutedBackground}] #I#[fg=${bar.divider},bg=${bar.mutedBackground}] : #[fg=${bar.mutedForeground},bg=${bar.mutedBackground}]#W#{?window_flags,#[fg=${bar.accentA},bg=${bar.mutedBackground}] #F,} #[default]'
      '';
    };
  };
}
