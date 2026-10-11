# Протокол v0.3

WebSocket на том же домене, HTTPS → WSS. `/health` — HTTP endpoint.

## JOIN

```json
{"type":"join","protocol":3,"room":"TEST01","role":"player","clientId":"device-uuid","sessionId":"session-uuid","team":2}
```

HOST отправляет role=host. Ответ joined содержит epoch (ID процесса relay), retentionMs, нормализованную комнату, роль, TEAM, clientId. room_stats сообщает hostOnline, players, devices. Второй HOST получает host_already_connected. Повторный PLAYER с тем же ID заменяет старое соединение (close 4001).

## Команда

```json
{"type":"button","button":"JMI1","seq":1,"sessionId":"session-uuid","clientTs":1791670000000}
```

seq — положительное безопасное целое. Relay берёт clientId/TEAM из JOIN, а не из команды. Повтор того же ключа с другой кнопкой/командой отклоняется. clientTs — дата создания; часы устройства должны быть корректными.

Relay → PLAYER: ack с seq, sessionId, eventId, duplicate, delivered. ACK означает приём relay. Relay → HOST: button с eventId, team, clientId, sessionId, seq, button, clientTs, serverTs. v0.3-команды отправляются только HOST этой комнаты.

HOST выполняет уникальную команду, сохраняет eventId и отвечает:

```json
{"type":"host_ack","eventId":"[\"device-uuid\",\"session-uuid\",1]"}
```

Для повторов HOST отправляет ACK без выполнения. Relay → PLAYER: delivered с seq, sessionId, eventId. Телефон удаляет команду из очереди только после delivered или ack.delivered=true. Relay повторяет неподтверждённые команды каждые ~2–3 секунды; PLAYER повторяет очередь каждые ~3–4 секунды.

ping_app / pong_app сохранены. PLAYER metrics передаёт sent/lost/pending и RTT; это диагностическая телеметрия, не авторитетный журнал игры.

Ошибки: invalid_json, invalid_message, room_required, join_first, host_already_connected, host_required, player_required, invalid_command, session_mismatch, sequence_conflict, command_expired, command_capacity, device_capacity, room_capacity, unknown_type. Ошибки команд включают seq.

## Контракт адаптера

Client: start(), stop(), press('JMI1'|'JMI2'); свойства ready, team, stats, queue. Настройки: url, room, role, clientId, team, WebSocket, storage(getItem/setItem), onCommand, onEvent, onState, onStats.

onCommand должен синхронно завершить действие. HOST подтверждает его после сохранения дедупликации. Для Electron используйте отдельное постоянное хранилище на комнату и стабильный host clientId. Дедупликация хранится чуть дольше срока очереди. Транзакционная связь журнала и игрового состояния — ответственность интеграции игры.
