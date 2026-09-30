install_tmux_control_tower() {
    TS="$(date +%Y%m%d-%H%M%S)"

    echo
    echo "=============================================="
    echo " TMUX CONTROL TOWER 설치 시작"
    echo "=============================================="

    # ---------------------------------------------------------
    # 0. 디렉터리 + 기존 설정 백업
    # ---------------------------------------------------------
    mkdir -p \
        "$HOME/bin" \
        "$HOME/.config/tmux" \
        "$HOME/.config/ju-shell" \
        "$HOME/.config/tmux-control-tower" \
        "$HOME/.cache/tmux-control-tower"

    touch "$HOME/.tmux.conf"
    touch "$HOME/.bashrc"

    cp -a "$HOME/.tmux.conf" "$HOME/.tmux.conf.bak.$TS"
    cp -a "$HOME/.bashrc" "$HOME/.bashrc.bak.$TS"

    echo "✓ 기존 설정 백업 완료"
    echo "  ~/.tmux.conf.bak.$TS"
    echo "  ~/.bashrc.bak.$TS"

    # ---------------------------------------------------------
    # 1. 관제탑 본체
    # ---------------------------------------------------------
    cat > "$HOME/bin/tmux-control" <<'CONTROL_EOF'
#!/usr/bin/env bash

REFRESH_SECONDS=2
WORKING_HOLD_SECONDS=8
CAPTURE_LINES=30
CONTROL_WINDOW="CONTROL"

STATE_DIR="$HOME/.cache/tmux-control-tower"
HOST_FILE="$HOME/.config/tmux-control-tower/host"

mkdir -p "$STATE_DIR"

SESSION="$(tmux display-message -p '#S' 2>/dev/null)"

if [[ -z "$SESSION" ]]; then
    echo "tmux session을 찾을 수 없습니다."
    exit 1
fi

SAFE_SESSION="$(
    printf '%s' "$SESSION" |
        tr -c '[:alnum:]_.-' '_'
)"

SEEN_FILE="$STATE_DIR/seen.$SAFE_SESSION"
touch "$SEEN_FILE"

declare -A LAST_HASH
declare -A ACTIVE_UNTIL

declare -a ROW_SESSION
declare -a ROW_WINDOW
declare -a ROW_PANE_INDEX
declare -a ROW_PANE_ID
declare -a ROW_HOST
declare -a ROW_TITLE
declare -a ROW_AGENT
declare -a ROW_STATUS

SELECTED=0
LAST_REFRESH=0
STATUS_RESULT=""

# =============================================================
# Terminal lifecycle
# =============================================================

restore_terminal() {
    printf '\033[0m'
    printf '\033[?25h'
    stty sane 2>/dev/null || true
}

quit_control() {
    restore_terminal
    exit 0
}

interrupt_control() {
    restore_terminal
    exit 130
}

trap interrupt_control INT
trap quit_control TERM HUP
trap restore_terminal EXIT

printf '\033[?25l'

# =============================================================
# Seen / visited
# =============================================================

is_seen() {
    local pane_id="$1"

    grep -Fxq "$pane_id" "$SEEN_FILE" 2>/dev/null
}

mark_seen() {
    local pane_id="$1"

    if ! is_seen "$pane_id"; then
        printf '%s\n' "$pane_id" >> "$SEEN_FILE"
    fi
}

# =============================================================
# Pane capture
# =============================================================

capture_pane() {
    local pane_id="$1"

    tmux capture-pane \
        -p \
        -t "$pane_id" \
        -S "-${CAPTURE_LINES}" 2>/dev/null
}

# =============================================================
# WAITING detection
#
# WAITING =
# Agent가 다음 사용자 입력 / 승인 / 선택을 기다리는 상태 추정
# =============================================================

is_waiting() {
    local content="$1"
    local tail_text
    local last_line

    tail_text="$(
        printf '%s\n' "$content" |
            tail -n 14
    )"

    # 명시적인 승인 / 입력 요청
    if printf '%s\n' "$tail_text" |
        grep -Eiq \
        'approve|approval|permission required|allow this|approve this|confirm|continue\?|press enter|enter to continue|y/n|yes/no|do you want|would you like|waiting for input|choose an option|select an option'
    then
        return 0
    fi

    # Codex / Claude 계열 입력 프롬프트 추정
    last_line="$(
        printf '%s\n' "$tail_text" |
            awk 'NF { line=$0 } END { print line }'
    )"

    if [[ "$last_line" =~ ^[[:space:]]*[›❯\>] ]]; then
        return 0
    fi

    return 1
}

# =============================================================
# Agent detection
# =============================================================

display_agent() {
    local command="$1"
    local title="$2"

    case "${title,,}" in
        *codex*)
            printf 'Codex'
            ;;
        *claude*)
            printf 'Claude'
            ;;
        *opencode*)
            printf 'OpenCode'
            ;;
        *grok*)
            printf 'Grok'
            ;;
        *gemini*)
            printf 'Gemini'
            ;;
        *cursor*)
            printf 'Cursor'
            ;;
        *)
            case "${command,,}" in
                codex*)
                    printf 'Codex'
                    ;;
                claude*)
                    printf 'Claude'
                    ;;
                opencode*)
                    printf 'OpenCode'
                    ;;
                ssh*)
                    printf 'SSH'
                    ;;
                bash|zsh|fish)
                    printf 'Shell'
                    ;;
                *)
                    printf '%s' "$command"
                    ;;
            esac
            ;;
    esac
}

# =============================================================
# Host detection
# =============================================================

get_default_host() {
    if [[ -f "$HOST_FILE" ]]; then
        head -n 1 "$HOST_FILE"
    else
        hostname -s
    fi
}

detect_host() {
    local window_index="$1"
    local window_name="$2"
    local default_host="$3"

    # ASUS 자체에서 실행 중이면 전부 ASUS
    if [[ "${default_host^^}" == "ASUS" ]]; then
        printf 'ASUS'
        return
    fi

    # MainPC 로컬 tmux:
    # Window 0 = MAINPC
    # Window 1 = ASUS SSH 작업공간
    case "${window_name^^}" in
        *ASUS*)
            printf 'ASUS'
            return
            ;;
        *MAINPC*|*MAIN*)
            printf 'MAINPC'
            return
            ;;
    esac

    case "$window_index" in
        0)
            printf 'MAINPC'
            ;;
        1)
            printf 'ASUS'
            ;;
        *)
            printf '%s' "$default_host"
            ;;
    esac
}

# =============================================================
# Status detection
#
# CHECKING = 아직 사용자가 해당 pane에 들어가 확인하지 않음
# WAITING  = Agent가 사용자 입력/승인/선택 대기
# WORKING  = 최근 실제 terminal 출력이 계속 변화함
# IDLE     = 확인한 pane이며 현재 출력 변화가 없음
# DEAD     = 종료된 pane
# =============================================================

detect_status() {
    local pane_id="$1"
    local pane_dead="$2"
    local content="$3"
    local now="$4"

    STATUS_RESULT="IDLE"

    if [[ "$pane_dead" == "1" ]]; then
        STATUS_RESULT="DEAD"
        return
    fi

    if ! is_seen "$pane_id"; then
        STATUS_RESULT="CHECKING"
        return
    fi

    local current_hash

    current_hash="$(
        printf '%s' "$content" |
            sha256sum |
            awk '{print $1}'
    )"

    # 처음 관측할 때 baseline
    if [[ -z "${LAST_HASH[$pane_id]+x}" ]]; then
        LAST_HASH["$pane_id"]="$current_hash"
        ACTIVE_UNTIL["$pane_id"]=0

        if is_waiting "$content"; then
            STATUS_RESULT="WAITING"
        else
            STATUS_RESULT="IDLE"
        fi

        return
    fi

    # 화면 출력 변화
    if [[ "${LAST_HASH[$pane_id]}" != "$current_hash" ]]; then
        LAST_HASH["$pane_id"]="$current_hash"
        ACTIVE_UNTIL["$pane_id"]=$((now + WORKING_HOLD_SECONDS))
        STATUS_RESULT="WORKING"
        return
    fi

    # 출력이 잠깐 멈춰도 바로 IDLE로 튀지 않도록 유지
    if (( ${ACTIVE_UNTIL[$pane_id]:-0} >= now )); then
        STATUS_RESULT="WORKING"
        return
    fi

    # 출력이 멈춘 뒤 사용자 입력 대기 확인
    if is_waiting "$content"; then
        STATUS_RESULT="WAITING"
        return
    fi

    STATUS_RESULT="IDLE"
}

# =============================================================
# Load rows
# =============================================================

load_rows() {
    local previous_pane=""

    if [[ ${#ROW_PANE_ID[@]} -gt 0 ]] &&
       (( SELECTED < ${#ROW_PANE_ID[@]} ))
    then
        previous_pane="${ROW_PANE_ID[$SELECTED]}"
    fi

    ROW_SESSION=()
    ROW_WINDOW=()
    ROW_PANE_INDEX=()
    ROW_PANE_ID=()
    ROW_HOST=()
    ROW_TITLE=()
    ROW_AGENT=()
    ROW_STATUS=()

    local separator=$'\x1f'
    local index=0
    local now
    local default_host

    now="$(date +%s)"
    default_host="$(get_default_host)"

    while IFS="$separator" read -r \
        session_name \
        window_index \
        window_name \
        pane_index \
        pane_id \
        pane_title \
        pane_command \
        pane_dead
    do
        [[ -z "$pane_id" ]] && continue

        # 관제탑 자기 자신은 목록에서 제외
        [[ "$window_name" == "$CONTROL_WINDOW" ]] && continue

        local host
        local content
        local agent
        local title

        host="$(
            detect_host \
                "$window_index" \
                "$window_name" \
                "$default_host"
        )"

        content="$(capture_pane "$pane_id")"

        detect_status \
            "$pane_id" \
            "$pane_dead" \
            "$content" \
            "$now"

        agent="$(
            display_agent \
                "$pane_command" \
                "$pane_title"
        )"

        title="$pane_title"

        if [[ -z "$title" ]]; then
            title="(unnamed)"
        fi

        ROW_SESSION[$index]="$session_name"
        ROW_WINDOW[$index]="$window_index"
        ROW_PANE_INDEX[$index]="$pane_index"
        ROW_PANE_ID[$index]="$pane_id"
        ROW_HOST[$index]="$host"
        ROW_TITLE[$index]="$title"
        ROW_AGENT[$index]="$agent"
        ROW_STATUS[$index]="$STATUS_RESULT"

        ((index+=1))

    done < <(
        tmux list-panes \
            -s \
            -t "$SESSION" \
            -F "#{session_name}${separator}#{window_index}${separator}#{window_name}${separator}#{pane_index}${separator}#{pane_id}${separator}#{pane_title}${separator}#{pane_current_command}${separator}#{pane_dead}"
    )

    local count="${#ROW_PANE_ID[@]}"

    if (( count == 0 )); then
        SELECTED=0
        return
    fi

    # 새로고침해도 선택 위치 유지
    if [[ -n "$previous_pane" ]]; then
        local i

        for ((i=0; i<count; i++)); do
            if [[ "${ROW_PANE_ID[$i]}" == "$previous_pane" ]]; then
                SELECTED="$i"
                return
            fi
        done
    fi

    if (( SELECTED >= count )); then
        SELECTED=$((count - 1))
    fi
}

# =============================================================
# UI
# =============================================================

status_text() {
    case "$1" in
        CHECKING)
            printf '? CHECKING'
            ;;
        WAITING)
            printf '! WAITING'
            ;;
        WORKING)
            printf '● WORKING'
            ;;
        IDLE)
            printf '○ IDLE'
            ;;
        DEAD)
            printf '× DEAD'
            ;;
        *)
            printf '? UNKNOWN'
            ;;
    esac
}

count_status() {
    local wanted="$1"
    local count=0
    local value

    for value in "${ROW_STATUS[@]}"; do
        if [[ "$value" == "$wanted" ]]; then
            ((count+=1))
        fi
    done

    printf '%s' "$count"
}

render() {
    printf '\033[H'

    local working
    local waiting
    local idle
    local checking
    local dead

    working="$(count_status WORKING)"
    waiting="$(count_status WAITING)"
    idle="$(count_status IDLE)"
    checking="$(count_status CHECKING)"
    dead="$(count_status DEAD)"

    printf '╔══════════════════════════════════════════════════════════════════════════════════════════╗\n'
    printf '║                                  AGENT CONTROL TOWER                                     ║\n'
    printf '╠══════════════════════════════════════════════════════════════════════════════════════════╣\n'
    printf '║  ● WORKING %-2s   ! WAITING %-2s   ○ IDLE %-2s   ? CHECKING %-2s   × DEAD %-2s                  ║\n' \
        "$working" "$waiting" "$idle" "$checking" "$dead"
    printf '╠══════════════════════════════════════════════════════════════════════════════════════════╣\n'
    printf '║  ↑ ↓  Move     Enter  Open     E  Rename     R  Refresh     Q / Ctrl+C  Exit            ║\n'
    printf '╠═════════╦═══════╦════════════════════════════════════╦════════════╦═══════════════╣\n'
    printf '║ HOST    ║ PANE  ║ PROJECT / TITLE                    ║ AGENT      ║ STATUS        ║\n'
    printf '╠═════════╬═══════╬════════════════════════════════════╬════════════╬═══════════════╣\n'

    local count="${#ROW_PANE_ID[@]}"

    if (( count == 0 )); then
        printf '║ %-88s ║\n' "No tmux panes found."
    else
        local i

        for ((i=0; i<count; i++)); do
            local status
            local pane_label

            status="$(status_text "${ROW_STATUS[$i]}")"
            pane_label="${ROW_WINDOW[$i]}.${ROW_PANE_INDEX[$i]}"

            if (( i == SELECTED )); then
                printf '\033[7m'
            fi

            printf '║ %-7.7s ║ %-5.5s ║ %-34.34s ║ %-10.10s ║ %-13.13s ║' \
                "${ROW_HOST[$i]}" \
                "$pane_label" \
                "${ROW_TITLE[$i]}" \
                "${ROW_AGENT[$i]}" \
                "$status"

            printf '\033[0m\n'
        done
    fi

    printf '╚═════════╩═══════╩════════════════════════════════════╩════════════╩═══════════════╝\n'

    if (( count > 0 )); then
        printf '\n  Selected  ›  %s  /  %s  /  %s\n' \
            "${ROW_HOST[$SELECTED]}" \
            "${ROW_TITLE[$SELECTED]}" \
            "${ROW_PANE_ID[$SELECTED]}"
    fi

    printf '\n'
    printf '  CHECKING : 아직 직접 열어보지 않은 pane\n'
    printf '  WAITING  : 사용자 입력 / 승인 / 선택 대기 추정\n'
    printf '  WORKING  : 최근 terminal 출력이 계속 발생 중\n'
    printf '  IDLE     : 확인은 했지만 현재 출력 변화 없음\n'
    printf '\n'
    printf '  어디서든 Ctrl+b → w  =  CONTROL 복귀\n'

    printf '\033[J'
}

# =============================================================
# Selection
# =============================================================

move_up() {
    local count="${#ROW_PANE_ID[@]}"

    (( count == 0 )) && return

    if (( SELECTED <= 0 )); then
        SELECTED=$((count - 1))
    else
        ((SELECTED-=1))
    fi
}

move_down() {
    local count="${#ROW_PANE_ID[@]}"

    (( count == 0 )) && return

    if (( SELECTED >= count - 1 )); then
        SELECTED=0
    else
        ((SELECTED+=1))
    fi
}

# =============================================================
# Open selected pane
# =============================================================

open_selected() {
    local count="${#ROW_PANE_ID[@]}"

    (( count == 0 )) && return

    local session
    local window
    local pane

    session="${ROW_SESSION[$SELECTED]}"
    window="${ROW_WINDOW[$SELECTED]}"
    pane="${ROW_PANE_INDEX[$SELECTED]}"

    mark_seen "${ROW_PANE_ID[$SELECTED]}"

    # 현재 tmux client만 해당 pane으로 이동
    tmux switch-client \
        -t "${session}:${window}.${pane}"
}

# =============================================================
# Rename selected pane
# =============================================================

rename_selected() {
    local count="${#ROW_PANE_ID[@]}"

    (( count == 0 )) && return

    local pane_id
    local current
    local new_title

    pane_id="${ROW_PANE_ID[$SELECTED]}"
    current="${ROW_TITLE[$SELECTED]}"
    new_title=""

    printf '\033[?25h'
    printf '\n\n'
    printf '  New PROJECT / TITLE\n'
    printf '  Current: %s\n' "$current"
    printf '  > '

    IFS= read -r new_title

    printf '\033[?25l'

    if [[ -n "$new_title" ]]; then
        tmux select-pane \
            -t "$pane_id" \
            -T "$new_title"
    fi

    load_rows
    render
}

# =============================================================
# Main
# =============================================================

load_rows
render

LAST_REFRESH="$(date +%s)"

while true; do
    current_time="$(date +%s)"

    if (( current_time - LAST_REFRESH >= REFRESH_SECONDS )); then
        load_rows
        render
        LAST_REFRESH="$current_time"
    fi

    key=""

    if ! IFS= read -rsn1 -t 0.1 key; then
        continue
    fi

    case "$key" in

        $'\x1b')
            key2=""
            key3=""

            IFS= read -rsn1 -t 0.05 key2 || true
            IFS= read -rsn1 -t 0.05 key3 || true

            case "${key2}${key3}" in
                '[A')
                    move_up
                    render
                    ;;
                '[B')
                    move_down
                    render
                    ;;
            esac
            ;;

        k)
            move_up
            render
            ;;

        j)
            move_down
            render
            ;;

        "")
            open_selected
            ;;

        e|E)
            rename_selected
            ;;

        r|R)
            load_rows
            render
            LAST_REFRESH="$(date +%s)"
            ;;

        q|Q)
            quit_control
            ;;
    esac
done
CONTROL_EOF

    chmod +x "$HOME/bin/tmux-control"

    # ---------------------------------------------------------
    # 2. CONTROL 열기 / 복귀
    # ---------------------------------------------------------
    cat > "$HOME/bin/tmux-control-open" <<'OPEN_EOF'
#!/usr/bin/env bash

CONTROL_WINDOW="CONTROL"

SESSION="${1:-}"

# tmux 안에서 실행했다면 현재 session
if [[ -z "$SESSION" && -n "${TMUX:-}" ]]; then
    SESSION="$(tmux display-message -p '#S' 2>/dev/null)"
fi

# tmux 밖이라면 attached session 우선
if [[ -z "$SESSION" ]]; then
    SESSION="$(
        tmux list-sessions \
            -F '#{session_name}|#{session_attached}|#{session_activity}' \
            2>/dev/null |
        sort -t'|' -k2,2nr -k3,3nr |
        head -n 1 |
        cut -d'|' -f1
    )"
fi

if [[ -z "$SESSION" ]]; then
    echo "실행 중인 tmux session이 없습니다."
    echo "먼저 tmux를 실행하세요."
    exit 1
fi

# CONTROL Window가 없으면 생성
if ! tmux list-windows \
        -t "$SESSION" \
        -F '#{window_name}' \
        2>/dev/null |
        grep -Fxq "$CONTROL_WINDOW"
then
    tmux new-window \
        -d \
        -t "${SESSION}:" \
        -n "$CONTROL_WINDOW" \
        "$HOME/bin/tmux-control"
fi

# tmux 안
if [[ -n "${TMUX:-}" ]]; then
    tmux switch-client \
        -t "${SESSION}:${CONTROL_WINDOW}"

    exit 0
fi

# tmux 밖
tmux select-window \
    -t "${SESSION}:${CONTROL_WINDOW}" \
    2>/dev/null || true

exec tmux attach-session -t "$SESSION"
OPEN_EOF

    chmod +x "$HOME/bin/tmux-control-open"

    # ---------------------------------------------------------
    # 3. Pane 방문 기록
    # ---------------------------------------------------------
    cat > "$HOME/bin/tmux-control-mark-seen" <<'SEEN_EOF'
#!/usr/bin/env bash

PANE_ID="${1:-}"
SESSION="${2:-}"

[[ -z "$PANE_ID" ]] && exit 0
[[ -z "$SESSION" ]] && exit 0

STATE_DIR="$HOME/.cache/tmux-control-tower"

mkdir -p "$STATE_DIR"

SAFE_SESSION="$(
    printf '%s' "$SESSION" |
        tr -c '[:alnum:]_.-' '_'
)"

SEEN_FILE="$STATE_DIR/seen.$SAFE_SESSION"
touch "$SEEN_FILE"

if ! grep -Fxq "$PANE_ID" "$SEEN_FILE" 2>/dev/null; then
    printf '%s\n' "$PANE_ID" >> "$SEEN_FILE"
fi
SEEN_EOF

    chmod +x "$HOME/bin/tmux-control-mark-seen"

    # ---------------------------------------------------------
    # 4. tmux 설정
    # ---------------------------------------------------------
    cat > "$HOME/.config/tmux/control-tower.conf" <<'TMUX_EOF'
# ============================================================
# TMUX CONTROL TOWER
# ============================================================

# Pane 위쪽에 이름 표시
set-window-option -g pane-border-status top
set-window-option -g pane-border-format ' #{?pane_active,▶ , }#P │ #{pane_title} '

# 프로그램이 Window 이름을 마음대로 바꾸는 것 방지
set-window-option -g allow-rename off
set-window-option -g automatic-rename off

# ------------------------------------------------------------
# Ctrl+b → w
# 기존 choose-tree 대신 CONTROL 관제탑
# ------------------------------------------------------------

unbind-key w
bind-key w run-shell -b "$HOME/bin/tmux-control-open '#{session_name}'"

# ------------------------------------------------------------
# Pane을 실제로 방문하면 CHECKING 해제
# ------------------------------------------------------------

set-hook -g after-select-pane \
    'run-shell -b "$HOME/bin/tmux-control-mark-seen #{pane_id} #{session_name}"'

set-hook -g after-select-window \
    'run-shell -b "$HOME/bin/tmux-control-mark-seen #{pane_id} #{session_name}"'

# ------------------------------------------------------------
# tmux watch
# tmux 안에서:
#   tmux watch
# ------------------------------------------------------------

set -s command-alias[999] \
    'watch=run-shell "$HOME/bin/tmux-control-open"'
TMUX_EOF

    # ---------------------------------------------------------
    # 5. Shell 명령
    #
    # watch          = 관제탑
    # watch -n ...   = 원래 Linux watch
    # tw             = 관제탑
    # tower          = 관제탑
    # ---------------------------------------------------------
    cat > "$HOME/.config/ju-shell/tmux-control-tower.sh" <<'SHELL_EOF'
#!/usr/bin/env bash

watch() {
    if [[ "$#" -eq 0 ]]; then
        "$HOME/bin/tmux-control-open"
        return
    fi

    command watch "$@"
}

tw() {
    "$HOME/bin/tmux-control-open"
}

tower() {
    "$HOME/bin/tmux-control-open"
}
SHELL_EOF

    chmod +x "$HOME/.config/ju-shell/tmux-control-tower.sh"

    # ---------------------------------------------------------
    # 6. ~/.tmux.conf 자동 연결
    # ---------------------------------------------------------
    if ! grep -Fqx \
        'source-file ~/.config/tmux/control-tower.conf' \
        "$HOME/.tmux.conf"
    then
        cat >> "$HOME/.tmux.conf" <<'EOF'

# ============================================================
# TMUX CONTROL TOWER
# ============================================================
source-file ~/.config/tmux/control-tower.conf
EOF
    fi

    # ---------------------------------------------------------
    # 7. ~/.bashrc 자동 연결
    # ---------------------------------------------------------
    if ! grep -Fqx \
        'source ~/.config/ju-shell/tmux-control-tower.sh' \
        "$HOME/.bashrc"
    then
        cat >> "$HOME/.bashrc" <<'EOF'

# ============================================================
# TMUX CONTROL TOWER
# ============================================================
source ~/.config/ju-shell/tmux-control-tower.sh
EOF
    fi

    # ---------------------------------------------------------
    # 8. MainPC 설정
    # ---------------------------------------------------------
    printf 'MAINPC\n' \
        > "$HOME/.config/tmux-control-tower/host"

    # 기존 CHECKING 기록 초기화
    rm -f "$HOME/.cache/tmux-control-tower"/seen.* 2>/dev/null || true

    # 현재 tmux 서버가 있으면 즉시 reload
    if tmux list-sessions >/dev/null 2>&1; then
        tmux source-file "$HOME/.tmux.conf"
        echo "✓ MainPC tmux 설정 즉시 적용 완료"
    else
        echo "✓ MainPC 설정 저장 완료 (다음 tmux 실행 때 적용)"
    fi

    # 현재 Shell에서도 바로 watch/tw/tower 사용 가능
    source "$HOME/.config/ju-shell/tmux-control-tower.sh"

    # ---------------------------------------------------------
    # 9. ASUS 자동 설치
    # ---------------------------------------------------------
    echo
    echo "ASUS SSH 확인 중..."

    if ssh asus 'printf ok' 2>/dev/null | grep -q '^ok$'; then

        echo "✓ ASUS SSH 연결 확인"

        tar \
            -C "$HOME" \
            -czf - \
            bin/tmux-control \
            bin/tmux-control-open \
            bin/tmux-control-mark-seen \
            .config/tmux/control-tower.conf \
            .config/ju-shell/tmux-control-tower.sh |
        ssh asus '
            mkdir -p "$HOME/bin"
            mkdir -p "$HOME/.config/tmux"
            mkdir -p "$HOME/.config/ju-shell"
            mkdir -p "$HOME/.config/tmux-control-tower"
            mkdir -p "$HOME/.cache/tmux-control-tower"

            tar -xzf - -C "$HOME"
        '

        ssh asus 'bash -s' <<'ASUS_EOF'
TS="$(date +%Y%m%d-%H%M%S)"

touch "$HOME/.tmux.conf"
touch "$HOME/.bashrc"

cp -a "$HOME/.tmux.conf" "$HOME/.tmux.conf.bak.$TS"
cp -a "$HOME/.bashrc" "$HOME/.bashrc.bak.$TS"

chmod +x \
    "$HOME/bin/tmux-control" \
    "$HOME/bin/tmux-control-open" \
    "$HOME/bin/tmux-control-mark-seen" \
    "$HOME/.config/ju-shell/tmux-control-tower.sh"

printf 'ASUS\n' \
    > "$HOME/.config/tmux-control-tower/host"

rm -f \
    "$HOME/.cache/tmux-control-tower"/seen.* \
    2>/dev/null || true

if ! grep -Fqx \
    'source-file ~/.config/tmux/control-tower.conf' \
    "$HOME/.tmux.conf"
then
    cat >> "$HOME/.tmux.conf" <<'EOF'

# ============================================================
# TMUX CONTROL TOWER
# ============================================================
source-file ~/.config/tmux/control-tower.conf
EOF
fi

if ! grep -Fqx \
    'source ~/.config/ju-shell/tmux-control-tower.sh' \
    "$HOME/.bashrc"
then
    cat >> "$HOME/.bashrc" <<'EOF'

# ============================================================
# TMUX CONTROL TOWER
# ============================================================
source ~/.config/ju-shell/tmux-control-tower.sh
EOF
fi

if tmux list-sessions >/dev/null 2>&1; then
    tmux source-file "$HOME/.tmux.conf"
fi

echo "✓ ASUS CONTROL TOWER 설치 완료"
ASUS_EOF

    else
        echo "⚠ ASUS SSH 연결 실패"
        echo "  MainPC 설치는 정상 완료됐고 ASUS만 건너뜀."
    fi

    # ---------------------------------------------------------
    # 완료
    # ---------------------------------------------------------
    echo
    echo "=============================================="
    echo " 설치 완료"
    echo "=============================================="
    echo
    echo "관제탑 열기:"
    echo
    echo "  watch"
    echo "  tw"
    echo "  tower"
    echo
    echo "tmux 안에서는:"
    echo
    echo "  Ctrl+b → w"
    echo
    echo "또는:"
    echo
    echo "  tmux watch"
    echo
    echo
    echo "관제탑 조작:"
    echo
    echo "  ↑ ↓      선택"
    echo "  Enter    해당 pane 이동"
    echo "  E        PROJECT / TITLE 변경"
    echo "  R        즉시 새로고침"
    echo "  Q        종료"
    echo "  Ctrl+C   종료"
    echo
    echo "※ 설치 과정에서는 Window 이동을 하지 않았음."
    echo
}

install_tmux_control_tower
unset -f install_tmux_control_tower