if [[ $- =~ i ]]; then

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

fi
