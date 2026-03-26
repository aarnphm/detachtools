_w_projects_dir() {
    if [[ -n ${WORKTREE_PROJECTS_DIR:-} ]]; then
        printf '%s' "$WORKTREE_PROJECTS_DIR"
    elif [[ -n ${WORKTREE_BASE_DIR:-} ]]; then
        printf '%s' "$WORKTREE_BASE_DIR"
    else
        printf '%s' "$HOME/workspace"
    fi
}

_w_worktrees_dir() {
    local projects_dir="$1"
    if [[ -n ${WORKTREE_WORKTREES_DIR:-} ]]; then
        printf '%s' "$WORKTREE_WORKTREES_DIR"
    else
        printf '%s' "$projects_dir/worktrees"
    fi
}

_w_list_git_projects() {
    local projects_dir="$1"
    local dir
    [[ -d "$projects_dir" ]] || return
    for dir in "$projects_dir"/*/; do
        [[ -d "$dir/.git" ]] && printf '%s\n' "${dir%/}"
    done
}

_w_list_wt_projects() {
    local worktrees_dir="$1"
    local dir
    [[ -d "$worktrees_dir" ]] || return
    for dir in "$worktrees_dir"/*/; do
        printf '%s\n' "${dir%/}"
    done
}

_w_list_worktrees() {
    local worktrees_dir="$1" project="$2"
    local wt
    [[ -d "$worktrees_dir/$project" ]] || return
    for wt in "$worktrees_dir/$project"/*/; do
        printf '%s\n' "${wt%/}"
    done
}

_w_collect_positionals() {
    local skip_next=0
    local i word
    for (( i = 1; i < ${#COMP_WORDS[@]}; i++ )); do
        (( i == COMP_CWORD )) && continue
        word="${COMP_WORDS[i]}"
        if (( skip_next )); then
            skip_next=0
            continue
        fi
        case "$word" in
            --)         break ;;
            --remote|--base) skip_next=1; continue ;;
            --remote=*|--base=*) continue ;;
            --list|--help|-h|--rm) continue ;;
            --*) continue ;;
        esac
        printf '%s\n' "$word"
    done
}

_w_past_double_dash() {
    local i
    for (( i = 1; i < COMP_CWORD; i++ )); do
        [[ "${COMP_WORDS[i]}" == "--" ]] && return 0
    done
    return 1
}

_w_has_flag() {
    local flag="$1" i
    for (( i = 1; i < ${#COMP_WORDS[@]}; i++ )); do
        [[ "${COMP_WORDS[i]}" == "$flag" ]] && return 0
    done
    return 1
}

_w() {
    local cur="${COMP_WORDS[COMP_CWORD]}"
    local projects_dir worktrees_dir
    projects_dir="$(_w_projects_dir)"
    worktrees_dir="$(_w_worktrees_dir "$projects_dir")"

    if _w_past_double_dash; then
        COMPREPLY=()
        return
    fi

    local -a positionals
    mapfile -t positionals < <(_w_collect_positionals)
    local npos=${#positionals[@]}

    case "$npos" in
        0)
            local -a candidates=( --list --rm --help cd sync )
            local dir
            while IFS= read -r dir; do
                candidates+=( "${dir##*/}" )
            done < <(_w_list_git_projects "$projects_dir")
            mapfile -t COMPREPLY < <(compgen -W "${candidates[*]}" -- "$cur")
            ;;
        1)
            local first="${positionals[0]}"
            case "$first" in
                --rm)
                    local -a projects=()
                    while IFS= read -r dir; do
                        projects+=( "${dir##*/}" )
                    done < <(_w_list_git_projects "$projects_dir")
                    mapfile -t COMPREPLY < <(compgen -W "${projects[*]}" -- "$cur")
                    ;;
                cd)
                    local -a wt_projects=()
                    while IFS= read -r dir; do
                        wt_projects+=( "${dir##*/}" )
                    done < <(_w_list_wt_projects "$worktrees_dir")
                    mapfile -t COMPREPLY < <(compgen -W "${wt_projects[*]}" -- "$cur")
                    ;;
                sync|--list|--help|-h)
                    COMPREPLY=()
                    ;;
                *)
                    local -a worktrees=()
                    local wt
                    while IFS= read -r wt; do
                        worktrees+=( "${wt##*/}" )
                    done < <(_w_list_worktrees "$worktrees_dir" "$first")
                    mapfile -t COMPREPLY < <(compgen -W "${worktrees[*]}" -- "$cur")
                    ;;
            esac
            ;;
        2)
            local first="${positionals[0]}"
            local second="${positionals[1]}"
            case "$first" in
                --rm)
                    local -a worktrees=()
                    local wt
                    while IFS= read -r wt; do
                        worktrees+=( "${wt##*/}" )
                    done < <(_w_list_worktrees "$worktrees_dir" "$second")
                    mapfile -t COMPREPLY < <(compgen -W "${worktrees[*]}" -- "$cur")
                    ;;
                cd)
                    local -a worktrees=()
                    local wt
                    while IFS= read -r wt; do
                        worktrees+=( "${wt##*/}" )
                    done < <(_w_list_worktrees "$worktrees_dir" "$second")
                    mapfile -t COMPREPLY < <(compgen -W "${worktrees[*]}" -- "$cur")
                    ;;
                *)
                    mapfile -t COMPREPLY < <(compgen -W "--remote --base --" -- "$cur")
                    ;;
            esac
            ;;
        *)
            if [[ "$cur" == -* ]]; then
                mapfile -t COMPREPLY < <(compgen -W "--remote --base --" -- "$cur")
            else
                COMPREPLY=()
            fi
            ;;
    esac
}

complete -F _w w
