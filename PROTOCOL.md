# Протокол v0.4

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

## Датчики и быстрые образцы

PLAYER отправляет sensor-сообщения с произвольным именем канала, номером последовательности и небольшим JSON-образцом:

```json
{"type":"sensor","gameId":"ar.sensor.game","channel":"gyroscope","seq":42,"sample":{"x":0.1,"y":-0.2,"z":0.3},"clientTs":1791670000000}
```

Relay пересылает актуальный образец только HOST той же комнаты и не ставит его в очередь, не подтверждает и не сохраняет в журнале. Это подходит для положения телефона, акселерометра, геолокации, Gamepad и будущих компактных источников. Для новых каналов серверный код менять не требуется: имя должно соответствовать `[a-z][a-z0-9_.-]{0,47}`, образец — простой JSON-объект до 1 KiB. Глубина, количество полей и числовые значения ограничены. Частота — не более 25 образцов/с на телефон; `SensorHub` по умолчанию отправляет суммарно до 20/с с выбором самого свежего образца на каждом источнике.

PLAYER и HOST получают данные через `sendSensor(channel, sample)` и callback `onSensor(message)`. Встроенные источники и разрешения см. в README. Sensor API и геолокация доступны только в безопасном контексте; доступ должен запускаться прямым действием пользователя. Не отправляйте через этот канал бинарные данные камеры или микрофона.

ping_app / pong_app сохранены. PLAYER metrics передаёт sent/lost/pending и RTT; это диагностическая телеметрия, не авторитетный журнал игры.

Ошибки: invalid_json, invalid_message, room_required, join_first, host_already_connected, host_required, player_required, invalid_command, session_mismatch, sequence_conflict, command_expired, command_capacity, device_capacity, room_capacity, unknown_type. Ошибки команд включают seq.

## Контракт адаптера

Client: start(), stop(), press('JMI1'|'JMI2'), sendCommand(action,payload), sendSensor(channel,sample); свойства ready, team, stats, queue. Настройки: url или configUrl, mode, gameId, room, role, clientId, team, WebSocket, storage(getItem/setItem), onCommand, onSensor, onEvent, onState, onStats. Надёжные команды и заменяемые датчики имеют разную доставку: sensor не попадает в очередь и не должен использоваться для событий, которые нельзя потерять.

onCommand должен синхронно завершить действие. HOST подтверждает его после сохранения дедупликации. Для Electron используйте отдельное постоянное хранилище на комнату и стабильный host clientId. Дедупликация хранится чуть дольше срока очереди. Транзакционная связь журнала и игрового состояния — ответственность интеграции игры.

## Удалённая конфигурация

По умолчанию клиент загружает `https://raw.githubusercontent.com/Diplo3/AR-Games-Relay/main/relay-config.json`, кэшируя последний корректный документ. Для другого control plane передайте `configUrl`; на время игры серверная точка в манифесте должна совпадать у HOST и PLAYER.

Схема JSON: `schemaVersion:1`, монотонный `revision`, `protocol.minimum/current`, `endpoints.internet` (строка `wss:` или список резервных URL), `endpoints.lan` (`ws:` в локальной сети или `wss:`), `limits.maxPhonesPerRoom`, `limits.maxPendingCommandsPerPhone`, `limits.commandRetentionMinutes`, `limits.sensorSamplesPerPhonePerSecond`, `limits.maxSensorPayloadBytes`, `refreshSeconds`.

Клиент принимает только `wss:` для Internet и `ws:`/`wss:` для LAN. После смены URL он переподключается с тем же room, clientId, sessionId, seq, TEAM и локальной очередью. Если конфиг недоступен, он использует кэш и оповещает callback статуса. LAN URL типа `ws:` предназначен для Electron main process; браузер на HTTPS может блокировать незашифрованное LAN WebSocket.

Не включайте секреты, ключи доступа или персональные данные в манифест: он публичный. Сохраните URL control plane стабильным и меняйте в нём только relay endpoints и лимиты. Поддерживайте обратную совместимость протокола минимум в пределах одной текущей версии игры.
