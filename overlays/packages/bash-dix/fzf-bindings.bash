if [[ $- =~ i ]]; then

__dix_fzf_preview() {
  command fzf --preview '_fzf_complete_realpath {}' "$@"
}

_fzf_compgen_path() {
  command fd --hidden --follow --exclude .git . "$1"
}

_fzf_compgen_dir() {
  command fd --type d --hidden --follow --exclude .git . "$1"
}

_fzf_comprun() {
  local commandName="$1"
  shift

  case "$commandName" in
    export | unset)
      command fzf --preview "eval 'echo \$'{}" "$@"
      ;;
    ssh)
      command fzf --preview 'ssh -G {} 2>/dev/null | head -200' "$@"
      ;;
    kill | killall)
      command fzf --preview 'ps aux | rg --color=always --fixed-strings {}' "$@"
      ;;
    *)
      __dix_fzf_preview "$@"
      ;;
  esac
}

__dix_setup_fzf_completion() {
  declare -F _fzf_setup_completion >/dev/null || return 0

  _fzf_setup_completion path awk bat cat cp diff eza gls less ln ls mv nano nvim open rm sed source tree vim xdg-open
  _fzf_setup_completion dir cd pushd rmdir
}

__fzf_find_edit__() {
  local selected
  selected="$(fd --hidden --exclude .git --type f 2>/dev/null |
    FZF_DEFAULT_OPTS="--height ${FZF_TMUX_HEIGHT:-40%} --bind=ctrl-z:ignore --preview '_fzf_complete_realpath {}' +m ${FZF_CTRL_F_OPTS-}" \
    FZF_DEFAULT_OPTS_FILE='' fzf)"
  if [[ -n "$selected" ]]; then
    ${EDITOR:-vim} "$selected"
  fi
}

if ((BASH_VERSINFO[0] >= 4)); then
  bind -m vi-command -x '"\C-f": __fzf_find_edit__'
  bind -m vi-insert -x '"\C-f": __fzf_find_edit__'
  bind -m emacs-standard -x '"\C-f": __fzf_find_edit__'

  bind -m vi-command -x '"\C-p": show_keymaps'
  bind -m vi-insert -x '"\C-p": show_keymaps'
  bind -m emacs-standard -x '"\C-p": show_keymaps'
fi

__dix_setup_fzf_completion
unset -f __dix_setup_fzf_completion

fi
