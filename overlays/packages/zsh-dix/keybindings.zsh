stty intr '^C'
stty susp '^Z'
stty stop undef
bindkey -v
autoload -U select-word-style
select-word-style bash
autoload -Uz edit-command-line
zle -N edit-command-line

## delete ##
for keymap in emacs viins; do
  bindkey -M "$keymap" '^?' backward-delete-char
  bindkey -M "$keymap" '^H' backward-delete-char
  bindkey -M "$keymap" '^[[3~' delete-char
  bindkey -M "$keymap" '^[[3;5~' kill-word
  bindkey -M "$keymap" '^[[3;3~' kill-word
  bindkey -M "$keymap" '^[d' kill-word
  bindkey -M "$keymap" '^[^?' backward-kill-word
  bindkey -M "$keymap" '^[^H' backward-kill-word
done

## jump ##
for keymap in emacs viins vicmd; do
  bindkey -M "$keymap" '^[[H' beginning-of-line
  bindkey -M "$keymap" '^[[F' end-of-line
  bindkey -M "$keymap" '^[[1~' beginning-of-line
  bindkey -M "$keymap" '^[[4~' end-of-line
  bindkey -M "$keymap" '^[[7~' beginning-of-line
  bindkey -M "$keymap" '^[[8~' end-of-line
  bindkey -M "$keymap" '^X^E' edit-command-line
done
for keymap in emacs viins; do
  bindkey -M "$keymap" '^U' backward-kill-line
done

## move ##
for keymap in emacs viins; do
  bindkey -M "$keymap" '^[h' backward-char
  bindkey -M "$keymap" '^[j' down-line-or-history
  bindkey -M "$keymap" '^[k' up-line-or-history
  bindkey -M "$keymap" '^[l' forward-char
done
for keymap in emacs viins vicmd; do
  bindkey -M "$keymap" '^[[1;5C' forward-word
  bindkey -M "$keymap" '^[[1;5D' backward-word
  bindkey -M "$keymap" '^[[1;3C' forward-word
  bindkey -M "$keymap" '^[[1;3D' backward-word
done
for keymap in emacs viins; do
  bindkey -M "$keymap" '^[f' forward-word
  bindkey -M "$keymap" '^[b' backward-word
done
unset keymap

## history ##
autoload -U history-search-end
zle -N history-beginning-search-backward-end history-search-end
zle -N history-beginning-search-forward-end history-search-end
for keymap in emacs viins; do
  bindkey -M "$keymap" '^S' history-incremental-pattern-search-forward
done
unset keymap

## edit ##
bindkey -M viins -s "^A" "^[Isudo ^[A" # "t" for "toughguy"
