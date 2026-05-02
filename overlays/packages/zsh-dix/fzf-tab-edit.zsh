_dix_fzf_tab_edit() {
  emulate -L zsh
  setopt no_aliases

  local target="${realpath:-$word}"
  local -a editorCommand

  [[ -n "$target" && -f "$target" ]] || {
    { print -rn -- $'\a' > /dev/tty } 2> /dev/null || true
    return 0
  }

  editorCommand=(${=EDITOR:-vim})
  if { true < /dev/tty > /dev/tty } 2> /dev/null; then
    command "${editorCommand[@]}" -- "$target" < /dev/tty > /dev/tty 2>&1
  else
    command "${editorCommand[@]}" -- "$target"
  fi
}

_dix_fzf_tab_edit "$@"
