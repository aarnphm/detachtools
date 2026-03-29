bind 'set bell-style none'
stty -ixon -ixoff

shopt -s cdspell
shopt -s histappend
shopt -s cmdhist
shopt -s histverify
shopt -s checkwinsize
shopt -s autocd
shopt -s globstar
shopt -s nocaseglob

HISTCONTROL=ignoredups:erasedups

stty intr '^C'
stty susp '^Z'
stty stop undef
set -o vi
bind 'set show-mode-in-prompt on'
bind 'set vi-ins-mode-string \1\e[5 q\2'
bind 'set vi-cmd-mode-string \1\e[1 q\2'

bind 'set skip-completed-text on'

## delete ##
bind '"\C-?": backward-delete-char'
bind '"\C-h": backward-delete-char'
bind '"\e[3~": delete-char'
bind '"\e[3;5~": kill-word'
bind '"\e\C-?": backward-kill-word'

## jump ##
bind '"\e[H": beginning-of-line'
bind '"\e[F": end-of-line'
bind '"\e[1~": beginning-of-line'
bind '"\e[4~": end-of-line'
bind '"\e[7~": beginning-of-line'
bind '"\e[8~": end-of-line'
bind '"\C-u": backward-kill-line'

## move ##
bind '"\eh": backward-char'
bind '"\ej": next-history'
bind '"\ek": previous-history'
bind '"\el": forward-char'
bind '"\e[1;5C": forward-word'
bind '"\e[1;5D": backward-word'

## history ##
bind '"\C-s": forward-search-history'
bind -m vi-command '"\C-l": clear-screen'
bind -m vi-insert '"\C-l": clear-screen'
bind -m emacs-standard '"\C-l": clear-screen'

## edit: prepend sudo ##
bind '"\C-a": "\e0isudo \e$a"'
