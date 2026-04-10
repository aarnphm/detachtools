{config}: let
  systemTheme = config.home.sessionVariables.XDG_SYSTEM_THEME or "light";
  themes = {
    light = {
      ghosttyTheme = "Flexoki Light";
      bar = {
        background = "#fffcf0";
        mutedBackground = "#f2f0e5";
        foreground = "#100f0f";
        mutedForeground = "#6f6b62";
        divider = "#b7b5ac";
        accentA = "#c29969";
        accentB = "#8e81a2";
        currentWindowBackground = "#e6dfd0";
        currentWindowForeground = "#100f0f";
        prefixBackground = "#8e81a2";
        prefixForeground = "#fffcf0";
        clockDateBackground = "#c29969";
        clockDateForeground = "#100f0f";
        clockTimeBackground = "#100f0f";
        clockTimeForeground = "#fffcf0";
        messageBackground = "#c29969";
        messageForeground = "#100f0f";
        modeBackground = "#8e81a2";
        modeForeground = "#fffcf0";
        activeBorder = "#8e81a2";
        inactiveBorder = "#d6d0c4";
      };
    };
    dark = {
      ghosttyTheme = "Flexoki Dark";
      bar = {
        background = "#100f0f";
        mutedBackground = "#1c1b1a";
        foreground = "#cecdc3";
        mutedForeground = "#878580";
        divider = "#403e3c";
        accentA = "#c29969";
        accentB = "#8e81a2";
        currentWindowBackground = "#2a2827";
        currentWindowForeground = "#fffcf0";
        prefixBackground = "#8e81a2";
        prefixForeground = "#100f0f";
        clockDateBackground = "#c29969";
        clockDateForeground = "#100f0f";
        clockTimeBackground = "#cecdc3";
        clockTimeForeground = "#100f0f";
        messageBackground = "#c29969";
        messageForeground = "#100f0f";
        modeBackground = "#8e81a2";
        modeForeground = "#100f0f";
        activeBorder = "#8e81a2";
        inactiveBorder = "#403e3c";
      };
    };
  };
in
  (themes.${systemTheme} or themes.light)
  // {
    inherit systemTheme;
    isDark = systemTheme == "dark";
  }
