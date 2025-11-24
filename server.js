// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
require("dotenv").config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 정적 파일 (프론트) 제공
app.use(express.static(path.join(__dirname, "public")));

// ===== 게임 설정 =====
const MAX_ROUNDS = 5;   // 총 라운드(초성 개수)
const BASE_TIME = 10;   // 첫 사이클 턴 시간(초)
const TIME_STEP = 0.2;    // 사이클마다 줄어드는 시간(초)
const MIN_TIME = 1;     // 최소 턴 시간(초)

// ===== 표준국어대사전 API =====
const STD_DICT_KEY = process.env.STD_KO_DICT_KEY;

async function lookupKoreanWord(word) {
    if (!STD_DICT_KEY) {
        console.warn("⚠ STD_KO_DICT_KEY가 설정되어 있지 않습니다.");
        return { exists: false, definition: null };
    }

    const url =
        `https://stdict.korean.go.kr/api/search.do` +
        `?key=${STD_DICT_KEY}` +
        `&q=${encodeURIComponent(word)}` +
        `&req_type=json` +
        `&method=exact`;

    let res;
    try {
        res = await fetch(url, { method: "GET" });
    } catch (err) {
        console.error("사전 API 요청 실패:", err.message);
        return { exists: false, definition: null };
    }

    if (!res.ok) {
        console.warn("사전 API 응답 코드 이상:", res.status);
        return { exists: false, definition: null };
    }

    const text = await res.text();
    if (!text || !text.trim()) {
        console.warn("사전 API 응답이 비어 있음");
        return { exists: false, definition: null };
    }

    let data;
    try {
        data = JSON.parse(text);
    } catch (err) {
        console.warn("사전 API JSON 파싱 실패:", err.message);
        return { exists: false, definition: null };
    }

    const total = Number(data?.channel?.total ?? 0);
    if (!total || total <= 0) {
        return { exists: false, definition: null };
    }

    // 첫 번째 결과의 첫 번째 뜻을 우선 사용
    let definition = null;
    const items = data?.channel?.item;
    if (Array.isArray(items) && items.length > 0) {
        const senses = items[0]?.sense;
        if (Array.isArray(senses) && senses.length > 0) {
            definition = senses[0]?.definition ?? null;
        } else if (senses && typeof senses === "object") {
            definition = senses.definition ?? null;
        }
    } else if (items && typeof items === "object") {
        const senses = items.sense;
        if (Array.isArray(senses) && senses.length > 0) {
            definition = senses[0]?.definition ?? null;
        } else if (senses && typeof senses === "object") {
            definition = senses.definition ?? null;
        }
    }

    return { exists: true, definition };
}

async function isValidKoreanWord(word) {
    if (!STD_DICT_KEY) {
        console.warn("⚠ STD_KO_DICT_KEY가 설정되어 있지 않습니다.");
        return false;
    }

    const url =
        `https://stdict.korean.go.kr/api/search.do` +
        `?key=${STD_DICT_KEY}` +
        `&q=${encodeURIComponent(word)}` +
        `&req_type=json` +
        `&method=exact`;

    let res;
    try {
        res = await fetch(url, { method: "GET" });
    } catch (err) {
        // 네트워크 자체가 죽었을 때만 진짜 에러로 취급
        console.error("사전 API 요청 실패:", err.message);
        return false;
    }

    if (!res.ok) {
        console.warn("사전 API 응답 코드 이상:", res.status);
        return false;
    }

    // 여기서 바로 res.json() 하지 말고 text로 받아서 안전하게 파싱
    const text = await res.text();
    if (!text || !text.trim()) {
        // 비어 있으면 그냥 "없는 단어" 취급
        console.warn("사전 API 응답이 비어 있음");
        return false;
    }

    let data;
    try {
        data = JSON.parse(text);
    } catch (err) {
        console.warn("사전 API JSON 파싱 실패:", err.message);
        // 이 경우도 그냥 "사전에 없음"으로 처리
        return false;
    }

    const total = Number(data?.channel?.total ?? 0);
    return total > 0; // 1개 이상 존재하면 true
}

// ===== 한글 초성 유틸 =====
// 1) 한글 유니코드용 '진짜' 초성 19개 (내부 계산용)
const FULL_CHOSEONG_LIST = [
    "ㄱ","ㄲ","ㄴ","ㄷ","ㄸ",
    "ㄹ","ㅁ","ㅂ","ㅃ","ㅅ",
    "ㅆ","ㅇ","ㅈ","ㅉ","ㅊ",
    "ㅋ","ㅌ","ㅍ","ㅎ",
];

// 2) 게임에서 쓸 단순 초성 14개 (랜덤 생성/표시용)
const CHOSEONG_LIST = [
    "ㄱ","ㄴ","ㄷ","ㄹ","ㅁ",
    "ㅂ","ㅅ","ㅇ","ㅈ","ㅊ",
    "ㅋ","ㅌ","ㅍ","ㅎ",
];

// 3) 쌍자음 → 단자음으로 눌러주는 함수
function normalizeChoseongForGame(cho) {
    switch (cho) {
        case "ㄲ":
            return "ㄱ";
        case "ㄸ":
            return "ㄷ";
        case "ㅃ":
            return "ㅂ";
        case "ㅆ":
            return "ㅅ";
        case "ㅉ":
            return "ㅈ";
        default:
            return cho;
    }
}

// 4) 글자에서 초성 뽑기 (게임용으로 normalize까지)
function getChoseong(ch) {
    const code = ch.charCodeAt(0);
    if (code < 0xac00 || code > 0xd7a3) return null;
    const index = Math.floor((code - 0xac00) / (21 * 28));
    const raw = FULL_CHOSEONG_LIST[index];
    if (!raw) return null;
    return normalizeChoseongForGame(raw);
}

// word: 2글자 한글 단어, chosung2: 'ㄱㅈ' 이런 형태
function wordMatchesChosung(word, chosung2) {
    if (!word || word.length !== 2) return false;
    if (!chosung2 || chosung2.length !== 2) return false;

    const c1 = getChoseong(word[0]);
    const c2 = getChoseong(word[1]);
    if (!c1 || !c2) return false;

    return c1 === chosung2[0] && c2 === chosung2[1];
}

// 초성 두 글자 랜덤 생성 (라운드마다 1개) - 여기는 기존 14개 리스트 사용
function generateRandomChosungPair() {
    const idx1 = Math.floor(Math.random() * CHOSEONG_LIST.length);
    const idx2 = Math.floor(Math.random() * CHOSEONG_LIST.length);
    return CHOSEONG_LIST[idx1] + CHOSEONG_LIST[idx2];
}

// ===== 방 관리 로직 =====
// room 구조 예시:
// {
//   hostId,
//   round,                // 현재 라운드 (1..MAX_ROUNDS)
//   chosung,              // 이번 라운드 초성 (라운드 동안 고정)
//   players: [{id, nickname, score, isHost}],
//   currentPlayerIndex,   // 지금 턴인 플레이어 index
//   roundTurnCount,       // 이번 라운드에서 시작된 턴 수(0부터)
//   currentTimeLimit,     // 이번 턴 제한 시간
//   turnStartedAt,        // 이번 턴 시작 시각(ms)
//   timerId,
//   usedWords: Set        // 게임 전체 동안 사용된 단어
// }
const rooms = {};

function generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 4; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

function getRoomBySocketId(socketId) {
    for (const [code, room] of Object.entries(rooms)) {
        if (room.players.some((p) => p.id === socketId)) {
            return { code, room };
        }
    }
    return null;
}

function broadcastRoomUpdate(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    io.to(roomCode).emit("room_update", {
        players: room.players,
    });
}

// === 라운드 & 턴 제어 ===

// 새 라운드 시작 (초성 하나 뽑고, 이번 라운드 첫 턴 스타트)
function startNewRound(roomCode, startPlayerIndex) {
    const room = rooms[roomCode];
    if (!room) return;

    room.round += 1; // 라운드 증가
    room.chosung = generateRandomChosungPair(); // 이 라운드 동안 고정
    room.roundTurnCount = 0;                    // 이번 라운드에서 진행된 턴 수
    room.currentPlayerIndex = startPlayerIndex % room.players.length;
    room.currentTimeLimit = null;
    room.turnStartedAt = null;
    room.usedWords = new Set();

    console.log(`🔔 Room ${roomCode} Round ${room.round} 시작, 초성: ${room.chosung}`);
    startTurn(roomCode);
}

// 이번 라운드에서 현재 플레이어 턴 시작
function startTurn(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    const playerCount = room.players.length || 1;
    const currentIndex = room.currentPlayerIndex % playerCount;
    const currentPlayer = room.players[currentIndex];

    // 이번 라운드에서 몇 번째 턴인지 기준으로 사이클 계산
    const cycleCount = Math.floor(room.roundTurnCount / playerCount);

    let timeLimit = BASE_TIME - cycleCount * TIME_STEP;
    if (timeLimit < MIN_TIME) timeLimit = MIN_TIME;

    room.currentTimeLimit = timeLimit;
    room.turnStartedAt = Date.now();
    room.roundTurnCount += 1;

    if (room.timerId) {
        clearTimeout(room.timerId);
    }
    room.timerId = setTimeout(() => {
        handleTimeout(roomCode);
    }, timeLimit * 1000);

    io.to(roomCode).emit("round_started", {
        round: room.round,                  // 라운드 번호 (초성 고정 단위)
        chosung: room.chosung,              // 이번 라운드 초성
        timeLimit,
        currentPlayerId: currentPlayer.id,  // 지금 턴인 사람
    });
}

// 라운드 끝 (틀리거나, 시간초과 났을 때만 호출)
function endRound(roomCode, failedPlayerIndex, reason, penalty) {
    const room = rooms[roomCode];
    if (!room) return;

    if (room.timerId) {
        clearTimeout(room.timerId);
        room.timerId = null;
    }

    const failedPlayer = room.players[failedPlayerIndex];

    io.to(roomCode).emit("round_result", {
        round: room.round,
        players: room.players,
        result: {
            playerId: failedPlayer?.id || null,
            nickname: failedPlayer?.nickname || "알 수 없음",
            word: null, // 틀린 경우엔 단어는 클라이언트 콜백에서 로그
            success: false,
            gain: 0,
            penalty: penalty || 0,
            reason, // "timeout" | "wrong"
        },
    });

    // 다음 라운드 or 게임 종료
    if (room.round >= MAX_ROUNDS) {
        io.to(roomCode).emit("game_over", {
            players: room.players,
        });
        return;
    }

    // 다음 라운드는 실패한 플레이어부터 시작
    const nextStartIndex = failedPlayerIndex;
    setTimeout(() => startNewRound(roomCode, nextStartIndex), 1500);
}

// 시간 초과 처리
function handleTimeout(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    const playerIndex = room.currentPlayerIndex;
    const player = room.players[playerIndex];
    const penalty = 100;

    if (player) {
        player.score = Math.max(0, (player.score || 0) - penalty);
    }
    broadcastRoomUpdate(roomCode);

    console.log(`⏰ Room ${roomCode} - ${player?.nickname} 시간초과, -${penalty}점`);

    endRound(roomCode, playerIndex, "timeout", penalty);
}

// 현재 플레이어 턴이 성공적으로 끝났을 때 → 다음 플레이어로 턴 이동
function goToNextTurn(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    const playerCount = room.players.length;
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % playerCount;
    startTurn(roomCode);
}

function removePlayer(socketId) {
    const info = getRoomBySocketId(socketId);
    if (!info) return;
    const { code, room } = info;

    // 🔹 socket.io 방에서도 빼주기
    const sock = io.sockets.sockets.get(socketId);
    if (sock) {
        sock.leave(code);
    }

    // 게임 로직 상의 플레이어 목록에서 제거
    room.players = room.players.filter((p) => p.id !== socketId);

    // 방 비었으면 삭제
    if (room.players.length === 0) {
        if (room.timerId) clearTimeout(room.timerId);
        delete rooms[code];
        return;
    }

    // 방장이 나갔으면 첫 번째 인원을 새 방장으로
    if (room.hostId === socketId) {
        room.hostId = room.players[0].id;
        room.players = room.players.map((p, idx) => ({
            ...p,
            isHost: idx === 0,
        }));

        io.to(code).emit("host_changed", {
            newHostId: room.hostId,
        });
    }

    broadcastRoomUpdate(code);
}

// ===== 소켓 이벤트 =====
io.on("connection", (socket) => {
    console.log("✅ client connected:", socket.id);

    // 방 만들기
    socket.on("create_room", ({ nickname }, cb) => {
        if (!nickname) return cb?.({ ok: false, reason: "no_nickname" });

        let code;
        do {
            code = generateRoomCode();
        } while (rooms[code]);

        rooms[code] = {
            hostId: socket.id,
            round: 0,
            chosung: null,
            players: [
                {
                    id: socket.id,
                    nickname,
                    score: 0,
                    isHost: true,
                },
            ],
            currentPlayerIndex: 0,
            roundTurnCount: 0,
            currentTimeLimit: null,
            turnStartedAt: null,
            timerId: null,
            usedWords: new Set(), // 게임 전체 중복 체크용
        };

        socket.join(code);

        cb?.({
            ok: true,
            roomCode: code,
            isHost: true,
            meId: socket.id,
            players: rooms[code].players,
        });

        broadcastRoomUpdate(code);
    });

    // 방 입장
    socket.on("join_room", ({ roomCode, nickname }, cb) => {
        const code = (roomCode || "").toUpperCase();
        const room = rooms[code];

        if (!nickname) return cb?.({ ok: false, reason: "no_nickname" });
        if (!room) return cb?.({ ok: false, reason: "no_room" });
        if (room.players.length >= 8) {
            return cb?.({ ok: false, reason: "full" });
        }

        socket.join(code);

        room.players.push({
            id: socket.id,
            nickname,
            score: 0,
            isHost: false,
        });

        cb?.({
            ok: true,
            roomCode: code,
            isHost: false,
            meId: socket.id,
            players: room.players,
        });

        broadcastRoomUpdate(code);
    });

    // 게임 시작 (방장만)
    socket.on("start_game", ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;
        if (room.hostId !== socket.id) return;

        // 🔹 새 게임 시작 시 모든 플레이어 점수 리셋
        room.players.forEach((p) => {
            p.score = 0;
        });

        // 게임 상태 초기화
        room.round = 0;
        room.usedWords = new Set(); // 새 게임에서 사용 단어 초기화
        room.currentPlayerIndex = 0;
        room.roundTurnCount = 0;

        // 🔹 점수 초기화된 상태를 클라이언트에 반영
        broadcastRoomUpdate(roomCode);

        // 첫 라운드 시작
        startNewRound(roomCode, room.currentPlayerIndex);
    });

    // 정답 제출 (턴제)
    socket.on("submit_answer", async ({ roomCode, word }, cb) => {
        const room = rooms[roomCode];
        if (!room || !room.chosung) {
            return cb?.({ ok: false, reason: "no_round" });
        }

        const playerIndex = room.currentPlayerIndex;
        const player = room.players[playerIndex];

        // 내 턴인지 확인
        if (!player || player.id !== socket.id) {
            return cb?.({ ok: false, reason: "not_your_turn" });
        }

        if (!word || typeof word !== "string") {
            return cb?.({ ok: false, reason: "empty" });
        }

        const trimmed = word.trim();

        // 이미 게임 전체에서 사용된 단어인지 (재사용 금지지만 패널티 없음)
        if (room.usedWords && room.usedWords.has(trimmed)) {
            // 👉 모든 플레이어에게 "이 단어는 이미 사용됨" 시도 로그 브로드캐스트
            io.to(roomCode).emit("answer_attempt", {
                playerId: player.id,
                nickname: player.nickname,
                word: trimmed,
                ok: false,
                reason: "already_used",
            });

            return cb?.({ ok: false, reason: "already_used" });
        }

        // 1단계: 초성 검사 (틀려도 패널티 없음, 다시 시도 가능)
        if (!wordMatchesChosung(trimmed, room.chosung)) {
            io.to(roomCode).emit("answer_attempt", {
                playerId: player.id,
                nickname: player.nickname,
                word: trimmed,
                ok: false,
                reason: "chosung_mismatch",
            });

            return cb?.({ ok: false, reason: "chosung_mismatch" });
        }

        // 2단계: 사전 검사 (없는 단어여도 패널티 없이 다시 시도 가능)
        let exists = false;
        let definition = null;
        try {
            const result = await lookupKoreanWord(trimmed);
            exists = result.exists;
            definition = result.definition || null;
        } catch (err) {
            console.error("사전 API 오류:", err.message);
            io.to(roomCode).emit("answer_attempt", {
                playerId: player.id,
                nickname: player.nickname,
                word: trimmed,
                ok: false,
                reason: "dict_error",
            });
            return cb?.({ ok: false, reason: "dict_error" });
        }

        if (!exists) {
            // 사전에 없으면 그냥 "다시 작성" 안내만 (모두에게 오답 시도 로그)
            io.to(roomCode).emit("answer_attempt", {
                playerId: player.id,
                nickname: player.nickname,
                word: trimmed,
                ok: false,
                reason: "not_in_dict",
            });

            return cb?.({ ok: false, reason: "not_in_dict" });
        }

        // === 여기까지 통과하면 '올바른 단어' ===
        room.usedWords.add(trimmed); // 중복 방지용으로 등록

        const now = Date.now();
        const limit = room.currentTimeLimit || 10;
        const elapsed = (now - (room.turnStartedAt || now)) / 1000;
        const remained = Math.max(0, limit - elapsed);
        const ratio = remained / limit;          // 0~1
        const gain = Math.round(ratio * 100);    // 최대 100점

        player.score = (player.score || 0) + gain;

        // 👉 방 전체에 "정답 성공" 브로드캐스트
        io.to(roomCode).emit("answer_attempt", {
            playerId: player.id,
            nickname: player.nickname,
            word: trimmed,
            ok: true,
            reason: "correct",
            gain,
            score: player.score,
            definition,
        });

        cb?.({
            ok: true,
            reason: "correct",
            gain,
            score: player.score,
            definition,
        });

        console.log(`✅ Room ${roomCode} - ${player.nickname} "${trimmed}" 정답, +${gain}점`);
        broadcastRoomUpdate(roomCode);

        // 이번 턴 성공 → 같은 초성(같은 라운드)으로 다음 사람 턴
        if (room.timerId) {
            clearTimeout(room.timerId);
            room.timerId = null;
        }
        goToNextTurn(roomCode);
    });

    // 방 나가기
    socket.on("leave_room", () => {
        removePlayer(socket.id);
    });

    socket.on("disconnect", () => {
        console.log("❌ client disconnected:", socket.id);
        removePlayer(socket.id);
    });
});

// 서버 실행
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
