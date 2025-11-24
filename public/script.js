// script.js

// ===== socket.io 연결 =====
const socket = io();

const state = {
    view: "lobby", // 'lobby' | 'room' | 'game' | 'result'
    me: {
        id: null,
        nickname: "",
        isHost: false,
    },
    roomCode: null,
    players: [],
    round: 0,
    timer: 0,
    timerId: null,
    currentChosung: "",
    currentPlayerId: null, // 지금 턴인 플레이어 id
};

// ✅ 정답 제출 중복 방지 플래그
let isSubmittingAnswer = false;

// ===== 유틸 =====
function $(selector) {
    return document.querySelector(selector);
}

function showView(name) {
    state.view = name;
    document.querySelectorAll(".view").forEach((v) => {
        v.classList.remove("view-active");
    });
    $("#view-" + name).classList.add("view-active");
}

function renderPlayers() {
    const playerList = $("#player-list");
    const gamePlayerList = $("#game-player-list");

    playerList.innerHTML = "";
    gamePlayerList.innerHTML = "";

    state.players.forEach((p) => {
        const makeItem = (player) => {
            const li = document.createElement("li");
            li.className = "player-item";

            if (player.id === state.me.id) {
                li.classList.add("me");
            }
            if (player.id === state.currentPlayerId) {
                li.classList.add("current-turn");
            }

            const nameSpan = document.createElement("span");
            nameSpan.className = "player-name";
            nameSpan.textContent = player.nickname || "이름없음";

            if (player.isHost) {
                const tag = document.createElement("span");
                tag.className = "player-tag player-tag-host";
                tag.textContent = "방장";
                nameSpan.appendChild(tag);
            }

            const scoreSpan = document.createElement("span");
            scoreSpan.className = "player-score";
            scoreSpan.textContent = `${player.score ?? 0}점`;

            li.appendChild(nameSpan);
            li.appendChild(scoreSpan);
            return li;
        };

        playerList.appendChild(makeItem(p));
        gamePlayerList.appendChild(makeItem(p));
    });

    $("#player-count").textContent = `(${state.players.length}/8)`;
}

function updateRoomHeader() {
    $("#room-code-label").textContent = state.roomCode || "----";
    $("#game-room-code").textContent = state.roomCode || "----";

    const badgeRole = $("#badge-role");
    if (state.me.isHost) {
        badgeRole.textContent = "방장";
        $("#btn-start-game").disabled = false;
    } else {
        badgeRole.textContent = "참가자";
        $("#btn-start-game").disabled = true;
    }
}

function updateGameTop() {
    $("#game-round").textContent = state.round;

    const timerEl = $("#game-timer");
    if (!timerEl) return;

    const displayTime = Math.max(0, Math.ceil(state.timer));
    timerEl.textContent = displayTime + " 초";

    timerEl.classList.remove("timer-danger");
    if (displayTime <= 3) {
        timerEl.classList.add("timer-danger");
    }
}

function addLog(message, type) {
    const log = $("#game-log");
    const div = document.createElement("div");
    div.className = "game-log-entry";

    if (type === "success") {
        div.classList.add("game-log-entry--success");
    } else if (type === "fail") {
        div.classList.add("game-log-entry--fail");
    } else if (type === "system") {
        div.classList.add("game-log-entry--system");
    }

    div.textContent = message;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
}

function showCorrectToast(message) {
    let root = $("#toast-root");
    if (!root) {
        root = document.createElement("div");
        root.id = "toast-root";
        root.className = "toast-root";
        document.body.appendChild(root);
    }

    const toast = document.createElement("div");
    toast.className = "toast toast--correct";

    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.textContent = "🎉";

    const msgSpan = document.createElement("span");
    msgSpan.className = "toast-message";
    msgSpan.textContent = message;

    toast.appendChild(icon);
    toast.appendChild(msgSpan);
    root.appendChild(toast);

    // 애니메이션 시작
    requestAnimationFrame(() => {
        toast.classList.add("toast--show");
    });

    // 일정 시간 후 자동 제거
    setTimeout(() => {
        toast.classList.remove("toast--show");
        setTimeout(() => {
            toast.remove();
        }, 220);
    }, 1700);
}

// ===== Used word tooltip =====
let usedWordTooltipEl = null;

function getUsedWordTooltipEl() {
    if (usedWordTooltipEl) return usedWordTooltipEl;
    const el = document.createElement("div");
    el.className = "used-word-tooltip";
    document.body.appendChild(el);
    usedWordTooltipEl = el;
    return el;
}

function showUsedWordTooltip(target, text) {
    if (!text) return;

    const tooltip = getUsedWordTooltipEl();
    tooltip.textContent = text;

    const rect = target.getBoundingClientRect();
    const top = rect.top + window.scrollY - 6;      // 카드 위쪽 근처
    const left = rect.left + rect.width / 2;        // 중앙

    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;

    requestAnimationFrame(() => {
        tooltip.classList.add("used-word-tooltip--show");
    });
}

function hideUsedWordTooltip() {
    if (!usedWordTooltipEl) return;
    usedWordTooltipEl.classList.remove("used-word-tooltip--show");
}

function startTimer(seconds) {
    clearInterval(state.timerId);

    // 🔹 처음 들어온 값을 올림해서 정수로 맞춰줌 (2.8 -> 3)
    state.timer = Math.ceil(seconds);
    updateGameTop();

    state.timerId = setInterval(() => {
        state.timer -= 1;
        if (state.timer < 0) {
            clearInterval(state.timerId);
            state.timerId = null;
            return;
        }
        updateGameTop();
    }, 1000);
}

function renderResult() {
    const list = $("#result-list");
    list.innerHTML = "";

    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    sorted.forEach((p, idx) => {
        const li = document.createElement("li");
        const crown = idx === 0 ? "👑 " : "";
        li.textContent = `${crown}${p.nickname} - ${p.score}점`;
        list.appendChild(li);
    });
}

function setMyTurnUI(isMyTurn) {
    const answerInput = $("#answer-input");
    const submitBtn   = $("#btn-submit-answer");

    // 입력 가능 여부
    if (answerInput) answerInput.disabled = !isMyTurn;
    if (submitBtn)   submitBtn.disabled   = !isMyTurn;

    if (isMyTurn) {
        document.body.classList.add("my-turn");

        setTimeout(() => {
            if (answerInput && !answerInput.disabled) {
                answerInput.focus();
            }
        }, 50);
    } else {
        document.body.classList.remove("my-turn");
        // ✅ 내 턴이 아니면 제출 중 상태도 초기화
        isSubmittingAnswer = false;
    }
}

function addUsedWordCard(word, definition) {
    const container = $("#used-words");
    if (!container) return;

    const card = document.createElement("div");
    card.className = "used-word-card";

    const wordEl = document.createElement("div");
    wordEl.className = "used-word-card-word";
    wordEl.textContent = word;

    const defEl = document.createElement("div");
    defEl.className = "used-word-card-def";

    if (definition) {
        // 카드 안에서는 한 줄로만 보여주고
        defEl.textContent = definition;

        // 전체 뜻은 툴팁으로 처리
        card.dataset.definition = definition;

        // 카드 전체에 hover 이벤트
        card.addEventListener("mouseenter", () => {
            showUsedWordTooltip(card, card.dataset.definition);
        });
        card.addEventListener("mouseleave", () => {
            hideUsedWordTooltip();
        });
    } else {
        defEl.textContent = "";
    }

    card.appendChild(wordEl);
    card.appendChild(defEl);
    container.prepend(card);
    container.scrollLeft = 0;
}

// ===== socket 이벤트 =====
socket.on("connect", () => {
    console.log("✅ connected to server:", socket.id);
});

socket.on("room_update", ({ players }) => {
    state.players = players;
    renderPlayers();
});

// 한 턴 시작 (같은 round 안에서도 플레이어만 바뀔 수 있음)
socket.on("round_started", ({ round, chosung, timeLimit, currentPlayerId }) => {
    // 🔹 "이번 이벤트가 '새 게임의 1라운드 첫 턴'인지" 체크
    const isNewGameFirstRound = round === 1 && state.round !== 1;

    // state 갱신
    state.round = round;
    state.currentChosung = chosung;
    state.currentPlayerId = currentPlayerId;

    // 🔹 새 게임 시작 시에만 사용 단어 리스트 초기화
    if (isNewGameFirstRound) {
        const usedContainer = $("#used-words");
        if (usedContainer) usedContainer.innerHTML = "";
    }

    const isMyTurn = state.me.id === currentPlayerId;

    $("#chosung-text").textContent = chosung;
    $("#answer-input").value = "";
    $("#answer-message").textContent = "";
    $("#answer-message").className = "answer-message";

    setMyTurnUI(isMyTurn);

    const currentPlayer = state.players.find((p) => p.id === currentPlayerId);
    const nick = currentPlayer ? currentPlayer.nickname : "알 수 없음";

    addLog(`🎮 Round ${round} - 초성: ${chosung} · 차례: ${nick}`);

    showView("game");
    state.timer = timeLimit;
    updateGameTop();
    startTimer(timeLimit);
    renderPlayers();
});

// 라운드 종료 (누군가 틀렸거나, 시간초과 났을 때 한 번만 옴)
socket.on("round_result", ({ round, players, result }) => {
    clearInterval(state.timerId);
    state.timerId = null;

    state.players = players;
    renderPlayers();

    // 라운드 종료 후에는 입력 비활성 + 내 턴 강조 제거
    setMyTurnUI(false);

    if (result) {
        if (result.reason === "timeout") {
            addLog(
                `⏰ ${result.nickname} 님 시간 초과 (-${result.penalty}점)`,
                "fail"
            );
        } else if (result.reason === "wrong") {
            addLog(
                `❌ ${result.nickname} 님 라운드 실패 (-${result.penalty}점)`,
                "fail"
            );
        }
    }

    addLog(`⏱ Round ${round} 종료`, "system");
});

socket.on("game_over", ({ players }) => {
    clearInterval(state.timerId);
    state.timerId = null;

    setMyTurnUI(false); // ⭐ 내 턴 강조 제거

    state.players = players;
    renderPlayers();
    renderResult();
    addLog("🏁 게임 종료", "system");

    showView("result");
});

socket.on("host_changed", ({ newHostId }) => {
    const newHost = state.players.find(p => p.id === newHostId);
    if (newHost) {
        addLog(`👑 ${newHost.nickname} 님이 새로운 방장이 되었습니다.`);
    }

    // 내 역할 갱신
    state.players = state.players.map(p => ({
        ...p,
        isHost: p.id === newHostId
    }));

    state.me.isHost = state.me.id === newHostId;

    updateRoomHeader();
    renderPlayers();
});

socket.on("answer_attempt", ({ playerId, nickname, word, ok, reason, gain, score, definition }) => {
    let text = "";

    if (ok) {
        // 정답인 경우
        text = `✅ ${nickname} - "${word}" 정답 (+${gain}점, 현재 ${score}점)`;

        // 나 자신이라면 토스트 표시
        if (playerId === state.me.id) {
            showCorrectToast(`"${word}" 정답! +${gain}점 🎉`);
        }

        // 사용 단어 카드 추가 (정답인 경우만)
        addUsedWordCard(word, definition);
        addLog(text, "success");
    } else {
        // 오답/재시도인 경우
        if (reason === "already_used") {
            text = `♻️ ${nickname} - "${word}" (이미 사용된 단어)`;
        } else if (reason === "chosung_mismatch") {
            text = `❌ ${nickname} - "${word}" (초성이 일치하지 않음)`;
        } else if (reason === "not_in_dict") {
            text = `📕 ${nickname} - "${word}" (사전에 없음)`;
        } else if (reason === "dict_error") {
            text = `⚠️ ${nickname} - "${word}" (사전 서버 오류)`;
        } else {
            text = `❌ ${nickname} - "${word}" (실패: ${reason})`;
        }

        addLog(text, "fail");
    }
});

// ===== DOM 이벤트 =====
document.addEventListener("DOMContentLoaded", () => {
    // 로비 - 방 만들기
    $("#btn-create-room").addEventListener("click", () => {
        const nickname = $("#nickname").value.trim();
        if (!nickname) {
            alert("닉네임을 입력해 주세요.");
            $("#nickname").focus();
            return;
        }

        socket.emit("create_room", { nickname }, (res) => {
            if (!res || !res.ok) {
                alert("방 생성 실패: " + (res?.reason || "알 수 없는 오류"));
                return;
            }

            state.me.id = res.meId;
            state.me.nickname = nickname;
            state.me.isHost = res.isHost;
            state.roomCode = res.roomCode;
            state.players = res.players;

            updateRoomHeader();
            renderPlayers();
            showView("room");
        });
    });

    // 로비 - 방 입장
    $("#btn-join-room").addEventListener("click", () => {
        const nickname = $("#nickname").value.trim();
        const joinCode = $("#join-code").value.trim();

        if (!nickname) {
            alert("닉네임을 입력해 주세요.");
            $("#nickname").focus();
            return;
        }
        if (!joinCode) {
            alert("방 코드를 입력해 주세요.");
            $("#join-code").focus();
            return;
        }

        socket.emit(
            "join_room",
            { roomCode: joinCode, nickname },
            (res) => {
                if (!res || !res.ok) {
                    let msg = "입장 실패";
                    if (res?.reason === "no_room") msg = "존재하지 않는 방입니다.";
                    else if (res?.reason === "full") msg = "이미 인원이 가득 찼습니다.";
                    alert(msg);
                    return;
                }

                state.me.id = res.meId;
                state.me.nickname = nickname;
                state.me.isHost = res.isHost;
                state.roomCode = res.roomCode;
                state.players = res.players;

                updateRoomHeader();
                renderPlayers();
                showView("room");
            }
        );
    });

    // 대기방 - 게임 시작(방장만)
    $("#btn-start-game").addEventListener("click", () => {
        if (!state.me.isHost || !state.roomCode) return;
        socket.emit("start_game", { roomCode: state.roomCode });
    });

    // 대기방 - 나가기
    $("#btn-leave-room").addEventListener("click", () => {
        socket.emit("leave_room");
        state.roomCode = null;
        state.players = [];
        state.me.isHost = false;
        showView("lobby");
    });

    // 게임 - 정답 제출
    $("#btn-submit-answer").addEventListener("click", () => {
        const word = $("#answer-input").value.trim();
        const msg = $("#answer-message");

        if (!word) {
            msg.textContent = "단어를 입력해 주세요.";
            msg.className = "answer-message answer-message--error";
            return;
        }

        if (!state.roomCode) return;

        // ✅ 이미 제출 중이면 무시 (중복 emit 방지)
        if (isSubmittingAnswer) return;
        isSubmittingAnswer = true;

        socket.emit(
            "submit_answer",
            { roomCode: state.roomCode, word },
            (res) => {
                // ✅ 응답 받으면 다시 제출 가능 상태로
                isSubmittingAnswer = false;

                if (!res) return;

                if (!res.ok) {
                    let text = "다시 시도해 보세요.";

                    if (res.reason === "chosung_mismatch") {
                        text = "초성이 일치하지 않습니다. 다른 단어를 입력해 주세요.";
                    } else if (res.reason === "not_in_dict") {
                        text = "표준국어대사전에 없는 단어입니다. 다른 단어를 입력해 주세요.";
                    } else if (res.reason === "already_used") {
                        text = "이미 사용된 단어입니다. 다른 단어를 입력해 주세요.";
                    } else if (res.reason === "not_your_turn") {
                        text = "지금은 내 차례가 아닙니다.";
                    } else if (res.reason === "dict_error") {
                        text = "사전 서버 오류로 단어를 확인할 수 없습니다.";
                    } else if (res.reason === "empty") {
                        text = "단어를 입력해 주세요.";
                    }

                    msg.textContent = text;
                    msg.className = "answer-message answer-message--error";
                } else {
                    // 올바른 단어로 인정된 경우 (점수 0~100 가산)
                    msg.textContent = `"${word}" 정답! +${res.gain}점 · 현재 ${res.score}점`;
                    msg.className = "answer-message answer-message--ok answer-message--strong";
                }

                $("#answer-input").value = "";
            }
        );
    });


    // 엔터로 정답 제출
    $("#answer-input").addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            $("#btn-submit-answer").click();
        }
    });

    // 게임 - 나가기
    $("#btn-exit-game").addEventListener("click", () => {
        socket.emit("leave_room");
        clearInterval(state.timerId);
        state.timerId = null;

        setMyTurnUI(false); // ⭐

        state.roomCode = null;
        state.players = [];
        state.me.isHost = false;
        showView("lobby");
    });

    // 결과 화면 - 게임방(대기방)으로 돌아가기
    $("#btn-back-to-room").addEventListener("click", () => {
        // 방 정보/플레이어 정보는 그대로 두고 화면만 대기방으로 전환
        updateRoomHeader();
        renderPlayers();
        showView("room");
    });

    // 결과 화면 - 로비로
    $("#btn-back-to-lobby").addEventListener("click", () => {
        // 서버에 방 나가기 알림 보내기
        socket.emit("leave_room");

        // 클라이언트 상태 초기화
        state.roomCode = null;
        state.players = [];
        state.me.isHost = false;

        // 로비 화면으로 이동
        showView("lobby");
    });
});
