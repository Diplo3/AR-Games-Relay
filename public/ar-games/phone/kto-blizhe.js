(() => {
  const root = document.querySelector("#app"),
    params = new URLSearchParams(location.search),
    room = params.get("room"),
    key = "kto-blizhe:" + room;
  let lastQuestionId = null;
  let client = null,
    state = null,
    hostOnline = false,
    joining = false,
    selectedTeam = "",
    selectedOption = "",
    answerValue = "",
    errorText = "",
    connected = false;
  const clientId = localStorage.getItem(key + ":client") || crypto.randomUUID();
  localStorage.setItem(key + ":client", clientId);
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  function report(msg) {
    errorText = msg || "";
    render();
  }
  function render() {
    if (!room) {
      root.innerHTML =
        "<h1>QR-код не содержит номер комнаты</h1><p>Попросите ведущего открыть подключение через интернет.</p>";
      return;
    }
    const lobby = state?.kind !== "game";
    const teams = state?.teams || [];
    const question = state?.question;
    if (question?.id !== lastQuestionId) {
      lastQuestionId = question?.id;
      selectedOption = null;
      answerValue = "";
    }
    const already = !!state?.response;
    root.innerHTML = `<p class="status">${connected ? (hostOnline ? "Связь с ведущим установлена" : "Ждём ведущего…") : "Подключаемся к игре…"}</p>${lobby ? `<h1>Выберите команду</h1><p>Можно подключить только одну команду. Название команды задаёт ведущий.</p><div class="teams">${teams.length ? teams.map((team) => `<button data-team="${esc(team.id)}" class="${selectedTeam === team.id ? "selected" : ""}" ${joining ? "disabled" : ""}>${esc(team.name)}</button>`).join("") : "<p>Нет свободных команд. Ведущий может освободить команду.</p>"}</div><p class="error">${esc(errorText || state?.error || "")}</p>` : `<h1>${esc(question?.text || "Ожидайте вопрос")}</h1>${state.team?.active === false ? "<h2>Столик отключён ведущим</h2>" : state.status === "PAUSED" ? "<h2>Пауза · ждите ведущего</h2>" : already ? `<div class="answered"><b>Ответ принят</b>${esc(state.response.answer)}</div>` : state.status === "ACCEPTING" && question?.type === "choice" ? `<div class="options">${(question.options || []).map((option) => `<button data-option="${esc(option.id)}" class="${selectedOption === option.id ? "selected" : ""}">${esc(option.text)}</button>`).join("")}</div><button class="primary" id="submit">Отправить ответ</button>` : state.status === "ACCEPTING" ? `<label class="field"><input id="answer" inputmode="decimal" autocomplete="off" placeholder="Введите число" value="${esc(answerValue)}"></label><button class="primary" id="submit">Отправить ответ</button>` : state.question?.answer !== undefined ? `<h2>Ответ: ${esc(state.question.answer)} ${esc(state.question.answerUnit || "")}</h2>` : "<h2>Ожидайте команду ведущего</h2>"}<p class="error">${esc(errorText || state?.error || "")}</p>`}`;
    root.querySelectorAll("[data-team]").forEach(
      (button) =>
        (button.onclick = () => {
          if (joining) return;
          selectedTeam = button.dataset.team;
          joining = true;
          errorText = "";
          client.sendCommand("kto-blizhe.join", { teamId: selectedTeam });
          render();
        }),
    );
    root.querySelectorAll("[data-option]").forEach(
      (button) =>
        (button.onclick = () => {
          selectedOption = button.dataset.option;
          render();
        }),
    );
    const input = root.querySelector("#answer");
    if (input) input.oninput = () => (answerValue = input.value);
    const submit = root.querySelector("#submit");
    if (submit)
      submit.onclick = () => {
        if (question?.type === "choice" && !selectedOption)
          return report("Сначала выберите вариант ответа");
        const payload = {
          questionId: question.id,
          sessionId: state.sessionId,
          ...(question.type === "choice"
            ? { optionId: selectedOption }
            : { answer: answerValue.trim() }),
        };
        if (!question.type || question.type !== "choice") {
          if (!/^[-+]?\d+(?:[.,]\d+)?$/.test(payload.answer))
            return report("Введите число");
        }
        if (!client.sendCommand("kto-blizhe.answer", payload))
          return report("Не удалось отправить ответ. Проверьте связь.");
        errorText = "Ответ отправлен…";
        render();
      };
  }
  if (!room) {
    render();
    return;
  }
  client = new ARConnect.Client({
    room,
    role: "player",
    clientId,
    team: 1,
    gameId: "ar-games-kto-blizhe",
    onState: (status) => {
      connected = status === "Подключено";
      render();
    },
    onEvent: (event) => {
      if (event.type === "room_stats") {
        hostOnline = !!event.hostOnline;
        render();
      }
    },
    onGameState: (event) => {
      state = event.state || null;
      if (state?.kind === "game") joining = false;
      else if (state?.kind === "lobby" && state.error) joining = false;
      errorText = state?.error || "";
      render();
    },
  });
  client.start();
})();