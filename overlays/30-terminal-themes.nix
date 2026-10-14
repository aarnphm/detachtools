{self}: final: prev: let
  terminalTheme = final.writeShellScript "terminal-theme" ''
    case "''${DIX_TERMINAL_THEME:-}" in
      light|dark)
        printf '%s\n' "$DIX_TERMINAL_THEME"
        exit 0
        ;;
    esac

    ${
      if final.stdenv.hostPlatform.isDarwin
      then ''
        systemTheme=$(/usr/bin/defaults read -g AppleInterfaceStyle 2>/dev/null || true)
        if [[ "$systemTheme" == "Dark" ]]; then
          printf 'dark\n'
        else
          printf 'light\n'
        fi
      ''
      else ''
        detectedConfig=$(
          unset BAT_THEME DELTA_FEATURES
          ${final.lib.getExe prev.delta} --no-gitconfig --detect-dark-light="$1" --show-config
        ) || detectedConfig=""
        if [[ "$detectedConfig" =~ syntax-theme[[:space:]]*=[[:space:]]*GitHub ]]; then
          printf 'light\n'
        else
          printf 'dark\n'
        fi
      ''
    }
  '';

  wrapTerminalTool = name: package: text: let
    wrapper = final.writeShellScript name text;
  in
    final.symlinkJoin {
      name = "${name}-themed-${package.version}";
      inherit (package) version;
      meta = package.meta // {outputsToInstall = ["out"];};
      paths = map (output: package.${output}) (package.meta.outputsToInstall or ["out"]);
      postBuild = ''
        rm "$out/bin/${name}"
        cp ${wrapper} "$out/bin/${name}"
      '';
    };

  fzfColors = {
    light = "light,fg:#B7B5AC,bg:#FFFCF0,hl:#100F0F,fg+:#B7B5AC,bg+:#F2F0E5,hl+:#100F0F,border:#AF3029,header:#100F0F,gutter:#FFFCF0,spinner:#3AA99F,info:#3AA99F,separator:#F2F0E5,pointer:#D0A215,marker:#D14D41,prompt:#D0A215";
    dark = "dark,fg:#878580,bg:#100F0F,hl:#CECDC3,fg+:#878580,bg+:#1C1B1A,hl+:#CECDC3,border:#AF3029,header:#CECDC3,gutter:#100F0F,spinner:#24837B,info:#24837B,separator:#1C1B1A,pointer:#AD8301,marker:#AF3029,prompt:#AD8301";
  };
in {
  delta = wrapTerminalTool "delta" prev.delta ''
    themeArgs=()
    terminalTheme=""
    detectDarkLight=never
    if [[ -t 1 ]]; then
      detectDarkLight=always
    fi
    for argument in "$@"; do
      case "$argument" in
        --help|-h|--version|-V|--generate-completion)
          exec ${final.lib.getExe prev.delta} "$@"
          ;;
        --light|--dark)
          terminalTheme="''${argument#--}"
          ;;
        --color-only)
          detectDarkLight=always
          ;;
      esac
    done
    if [[ -z "$terminalTheme" ]]; then
      terminalTheme=$(${terminalTheme} "$detectDarkLight")
      themeArgs=("--$terminalTheme")
    fi
    export BAT_THEME="''${BAT_THEME:-gruvbox-$terminalTheme}"
    exec ${final.lib.getExe prev.delta} "''${themeArgs[@]}" "$@"
  '';

  fzf = wrapTerminalTool "fzf" prev.fzf ''
    for argument in "$@"; do
      case "$argument" in
        --help|--version|--man|--bash|--zsh|--fish|--nushell|-f|--filter|--filter=*)
          exec ${final.lib.getExe prev.fzf} "$@"
          ;;
      esac
    done
    terminalTheme=$(${terminalTheme} always)
    export DIX_TERMINAL_THEME="$terminalTheme"
    export BAT_THEME="''${BAT_THEME:-gruvbox-$terminalTheme}"
    if [[ "$terminalTheme" == "light" ]]; then
      colors=${final.lib.escapeShellArg fzfColors.light}
    else
      colors=${final.lib.escapeShellArg fzfColors.dark}
    fi
    exec ${final.lib.getExe prev.fzf} --color="$colors" "$@"
  '';
}
