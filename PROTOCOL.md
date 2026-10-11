# Протокол v0.4

WebSocket на том же домене, HTTPS → WSS. `/health` — HTTP endpoint.

## JOIN

```json
{"type":"join","protocol":3,"room":"TEST01","role":"player","gameId":"quiz.live","clientId":"device-uuid","sessionId":"session-uuid","team":50,"capabilities":["orientation","gyroscope"]}
```

HOST отправляет role=host. PLAYER может выбрать TEAM с числовым ID 1–50; команда включается в каждую игровую команду и сенсорный образец. Ответ joined содержит epoch (ID процесса relay), retentionMs, нормализованную комнату, роль, TEAM, clientId. room_stats сообщает hostOnline, players, devices. Второй HOST получает host_already_connected. Повторный PLAYER с тем же ID заменяет старое соединение (close 4001).

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

Ограничение v0.4 — 200 команд/с на подключённое устройство. При превышении relay отвечает `command_rate_limited`; клиент сохраняет команду и повторяет её позднее. `command_capacity` означает заполненный журнал relay и считается окончательной ошибкой для этой команды, чтобы она не оставалась в очереди до истечения 30 минут.

## Датчики и быстрые образцы

PLAYER отправляет sensor-сообщения с произвольным именем канала, номером последовательности и небольшим JSON-образцом:

```json
{"type":"sensor","gameId":"ar.sensor.game","channel":"gyroscope","seq":42,"sample":{"x":0.1,"y":-0.2,"z":0.3},"clientTs":1791670000000}
```

Relay пересылает актуальный образец только HOST той же комнаты и не ставит его в очередь, не подтверждает и не сохраняет в журнале. Это подходит для положения телефона, акселерометра, геолокации, Gamepad и будущих компактных источников. Для новых каналов серверный код менять не требуется: имя должно соответствовать `[a-z][a-z0-9_.-]{0,47}`, образец — простой JSON-объект до 1 KiB. Глубина, количество полей и числовые значения ограничены. Частота — не более 25 образцов/с на телефон; `SensorHub` по умолчанию отправляет суммарно до 20/с с выбором самого свежего образца на каждом источнике.

PLAYER и HOST получают данные через `sendSensor(channel, sample)` и callback `onSensor(message)`. Встроенные источники и разрешения см. в README. Sensor API и геолокация доступны только в безопасном контексте; доступ должен запускаться прямым действием пользователя. Не отправляйте через этот канал бинарные данные камеры или микрофона.

## Снимки состояния игры HOST → PLAYER

HOST публикует полное состояние комнаты, TEAM или устройства:

```json
{"type":"game_state_update","gameId":"quiz.live","team":7,"state":{"phase":"question","round":3,"questionId":"q-3","deadlineAt":1791670020000,"scores":{"7":120}}}
```

Пропущенные `team` и `clientId` означают всю комнату. Можно указать `team` (1–50) либо `clientId` (одно конкретное устройство). Клиенты получают `game_state` с revision, а их обработчик — `onGameState(message)`. Снимок должен быть полным, не частичным патчем; он ограничен 8 KiB. Relay держит последний снимок на каждую область и посылает подходящие снимки при JOIN. HOST сохраняет снимки в переданном storage и повторно публикует их при подключении к новому epoch relay. После перезапуска самого HOST игра должна загрузить своё сохранённое состояние и опубликовать его вновь.

`deadlineAt` задаётся абсолютным Unix-временем; таймер на телефоне отображается локально, без частых сетевых тиков. Действия игрока остаются в надёжном канале `command`; правила, проверка ответа, начисление очков и принятие решения «кто первым» выполняет HOST. `room_stats.devices[].capabilities` содержит доступные на каждом телефоне источники датчиков.

ping_app / pong_app сохранены. PLAYER metrics передаёт sent/lost/pending и RTT; это диагностическая телеметрия, не авторитетный журнал игры.

Ошибки: invalid_json, invalid_message, invalid_game, invalid_team, invalid_game_state, room_required, join_first, host_already_connected, host_required, player_required, invalid_command, session_mismatch, sequence_conflict, command_expired, command_capacity, command_rate_limited, device_capacity, room_capacity, unknown_type. Ошибки команд включают seq.

room_stats рассылается с короткой сводкой игрокам; подробный `devices[]` получает только HOST.

## Контракт адаптера

Client: start(), stop(), press('JMI1'|'JMI2'), sendCommand(action,payload), sendSensor(channel,sample), publishState(state,{team?,clientId?}); свойства ready, team, stats, queue. Настройки: url или configUrl, mode, gameId, room, role, clientId, team, capabilities, WebSocket, storage(getItem/setItem), onCommand, onSensor, onGameState, onEvent, onState, onStats. Надёжные команды, заменяемые измерения и восстанавливаемые снимки состояния имеют разную доставку: sensor не попадает в очередь; последнее game state восстанавливается при повторном JOIN.

onCommand может быть синхронным или вернуть Promise. HOST подтверждает команду только после успешного завершения обработчика и сохранения дедупликации; при ошибке команда остаётся без ACK и будет доставлена повторно. Поэтому обработчик должен быть идемпотентным по eventId: при интеграции с базой данных сохраняйте eventId вместе с игровым результатом в одной транзакции. Для Electron используйте отдельное постоянное хранилище на комнату и стабильный host clientId. Дедупликация хранится чуть дольше срока очереди.

## Удалённая конфигурация

По умолчанию клиент загружает `https://raw.githubusercontent.com/Diplo3/AR-Games-Relay/main/relay-config.json`, кэшируя последний корректный документ. Для другого control plane передайте `configUrl`; на время игры серверная точка в манифесте должна совпадать у HOST и PLAYER.

Схема JSON: `schemaVersion:1`, монотонный `revision`, `protocol.minimum/current`, `endpoints.internet` (строка `wss:` или список резервных URL), `endpoints.lan` (`ws:` в локальной сети или `wss:`), `limits.maxPhonesPerRoom`, `limits.maxTeamsPerRoom` (до 50), `limits.maxCommandsPerDevicePerSecond`, `limits.maxPendingCommandsPerPhone`, `limits.commandRetentionMinutes`, `limits.sensorSamplesPerPhonePerSecond`, `limits.maxSensorPayloadBytes`, `refreshSeconds`.

Клиент принимает только `wss:` для Internet и `ws:`/`wss:` для LAN. После смены URL он переподключается с тем же room, clientId, sessionId, seq, TEAM и локальной очередью. Если конфиг недоступен, он использует кэш и оповещает callback статуса. LAN URL типа `ws:` предназначен для Electron main process; браузер на HTTPS может блокировать незашифрованное LAN WebSocket.

Не включайте секреты, ключи доступа или персональные данные в манифест: он публичный. Сохраните URL control plane стабильным и меняйте в нём только relay endpoints и лимиты. Поддерживайте обратную совместимость протокола минимум в пределах одной текущей версии игры.
