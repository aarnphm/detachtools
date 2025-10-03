#compdef w

_w_projects_dir() {
    if [[ -n ${WORKTREE_PROJECTS_DIR:-} ]]; then
        print -r -- "$WORKTREE_PROJECTS_DIR"
    elif [[ -n ${WORKTREE_BASE_DIR:-} ]]; then
        print -r -- "$WORKTREE_BASE_DIR"
    else
        print -r -- "$HOME/workspace"
    fi
}

_w_worktrees_dir() {
    local projects_dir="$1"
    if [[ -n ${WORKTREE_WORKTREES_DIR:-} ]]; then
        print -r -- "$WORKTREE_WORKTREES_DIR"
    else
        print -r -- "$projects_dir/worktrees"
    fi
}

_w_list_projects() {
    local projects_dir="$1"
    local -a projects

    if [[ -d "$projects_dir" ]]; then
        local dir
        for dir in "$projects_dir"/*(N/); do
            if [[ -d "$dir/.git" ]]; then
                projects+=(${dir:t})
            fi
        done
    fi

    print -l -- $projects
}

_w_list_worktrees() {
    local worktrees_root="$1"
    local project="$2"
    local -a worktrees

    if [[ -d "$worktrees_root/$project" ]]; then
        local wt
        for wt in "$worktrees_root/$project"/*(N/); do
            worktrees+=(${wt:t})
        done
    fi

    print -l -- $worktrees
}

_w_collect_positionals() {
    local -a result
    local skip_next=0 word
    integer i

    for (( i = 2; i <= $#words; i++ )); do
        word=${words[i]}
        if (( skip_next )); then
            skip_next=0
            continue
        fi
        case $word in
            --)
                break
                ;;
            --remote|--base)
                skip_next=1
                continue
                ;;
            --remote=*|--base=*)
                continue
                ;;
            --list|--help|-h|--rm)
                continue
                ;;
            --*)
                continue
                ;;
        esac
        result+=($word)
    done

    print -l -- $result
}

_w_is_rm() {
    (( ${words[(I)--rm]} <= $#words ))
}

_w_command_start_index() {
    local count=0 skip_next=0 word
    integer i

    for (( i = 2; i <= $#words; i++ )); do
        word=${words[i]}
        if (( skip_next )); then
            skip_next=0
            continue
        fi
        case $word in
            --)
                if (( i < $#words )); then
                    echo $((i + 1))
                else
                    echo 0
                fi
                return
                ;;
            --remote|--base)
                skip_next=1
                continue
                ;;
            --remote=*|--base=*)
                continue
                ;;
            --list|--help|-h|--rm)
                continue
                ;;
            --*)
                continue
                ;;
        esac
        (( ++count ))
        if (( count == 3 )); then
            echo $i
            return
        fi
    done

    echo 0
}

_w_common_commands() {
    print -l -- \
        'claude:Start Claude session' \
        'codex:Start OpenAI Codex session' \
        'gst:Git status' \
        'gaa:Git add all' \
        'gcmsg:Git commit with message' \
        'gp:Git push' \
        'gco:Git checkout' \
        'gd:Git diff' \
        'gl:Git log' \
        'npm:Run npm command' \
        'yarn:Run yarn command' \
        'make:Run make command'
}

_w_active_project() {
    local -a positional
    positional=($(_w_collect_positionals))
    print -r -- ${positional[1]}
}

_w() {
    emulate -L zsh

    local curcontext="$curcontext" state
    typeset -A opt_args

    local projects_dir=$(_w_projects_dir)
    local worktrees_dir=$(_w_worktrees_dir "$projects_dir")

    _arguments -C \
        '(-)--help[Show usage]' \
        '(-)--list[List all worktrees]' \
        '(-)--rm[Remove a worktree]' \
        '--remote=[Remote repository URL]:remote repository:->remote' \
        '--base=[Base branch to track]:base branch:->base' \
        '1:first argument:->first' \
        '2:second argument:->second' \
        '3:command to run:->command' \
        '*::command arguments:->command_args' \
        && return 0

    case $state in
        remote)
            _message 'remote repository URL'
            return 0
            ;;
        base)
            local project=$(_w_active_project)
            if [[ -n $project ]]; then
                local repo="$projects_dir/$project"
                if [[ -d "$repo/.git" ]]; then
                    local -a branches
                    branches=(${(f)$(command git -C "$repo" for-each-ref --format='%(refname:short)' refs/heads 2>/dev/null)})
                    if (( ${#branches} )); then
                        compadd -a branches
                        return 0
                    fi
                fi
            fi
            _message 'base branch name'
            return 0
            ;;
        first)
            local ret=1
            local -a actions projects
            actions=(
                '--list:list all worktrees'
                '--rm:remove a worktree'
                '--help:show usage'
            )
            _describe -t actions 'action' actions && ret=0
            projects=($(_w_list_projects "$projects_dir"))
            if (( ${#projects} )); then
                _describe -t projects 'project' projects && ret=0
            fi
            return 0
            ;;
        second)
            local -a positional worktrees
            positional=($(_w_collect_positionals))
            local project=${positional[1]}
            if [[ -z $project ]]; then
                return 0
            fi

            worktrees=($(_w_list_worktrees "$worktrees_dir" "$project"))
            if (( ${#worktrees} )); then
                if _w_is_rm; then
                    _describe -t worktrees 'worktree to remove' worktrees
                else
                    _describe -t worktrees 'existing worktree' worktrees
                fi
            else
                if _w_is_rm; then
                    _message "no worktrees found for $project"
                else
                    _message 'new worktree name'
                fi
            fi
            return 0
            ;;
        command)
            if _w_is_rm; then
                return 0
            fi
            local -a options commands
            options=(
                '--remote:Remote repository URL'
                '--base:Base branch to track'
                '--:End of options'
            )
            _describe -t options 'option' options
            commands=($(_w_common_commands))
            _describe -t commands 'command' commands
            _command_names -e
            return 0
            ;;
        command_args)
            if _w_is_rm; then
                return 0
            fi

            local cmd_index=$(_w_command_start_index)
            if (( cmd_index == 0 )); then
                return 0
            fi

            local -a command_words
            command_words=(${(@)words[cmd_index,-1]})
            words=($command_words)
            CURRENT=$((CURRENT - cmd_index + 1))
            _normal
            return 0
            ;;
    esac
}

if [[ ${funcstack[1]} == "_w" ]]; then
    _w "$@"
fi
