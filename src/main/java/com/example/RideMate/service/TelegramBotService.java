package com.example.RideMate.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

@Service
public class TelegramBotService {

    @Value("${telegram.bot-token}")
    private String botToken;

    @Value("${telegram.webapp-url}")
    private String webappUrl;

    private final RestClient restClient;
    private final ObjectMapper objectMapper;
    private final UserService userService;

    private Long lastUpdateId = 0L;

    public TelegramBotService(ObjectMapper objectMapper, UserService userService) {
        this.objectMapper = objectMapper;
        this.userService = userService;
        this.restClient = RestClient.builder()
                .baseUrl("https://api.telegram.org")
                .build();
    }

    @PostConstruct
    public void init() {
        new Thread(this::startPolling).start();
    }

    private void startPolling() {
        while (true) {
            try {
                pollUpdates();
                Thread.sleep(2000);
            } catch (Exception e) {
                System.err.println("Error in Telegram polling: " + e.getMessage());
                try {
                    Thread.sleep(5000);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
    }

    private void pollUpdates() throws Exception {
        String url = "/bot" + botToken + "/getUpdates?timeout=1&offset=" + (lastUpdateId + 1);
        String response = restClient.get()
                .uri(url)
                .retrieve()
                .body(String.class);

        // ЛОГИРОВАНИЕ: выводим ответ в консоль (для отладки)
   //     System.out.println("Telegram API response: " + response);

        JsonNode root = objectMapper.readTree(response);
        if (!root.path("ok").asBoolean()) {
            System.err.println("Telegram API returned ok=false: " + response);
            return;
        }

        JsonNode updates = root.path("result");
        for (JsonNode update : updates) {
            lastUpdateId = update.path("update_id").asLong();

            if (update.has("message")) {
                JsonNode message = update.path("message");
                String text = message.path("text").asText("");

                // Безопасное извлечение id
                JsonNode fromNode = message.path("from");
                JsonNode chatNode = message.path("chat");

                if (!fromNode.isMissingNode() && !chatNode.isMissingNode()) {
                    Long telegramId = fromNode.path("id").asLong();
                    Long chatId = chatNode.path("id").asLong();

                    // Проверка на валидность
                    if (telegramId == null || telegramId == 0) {
                        System.err.println("Не удалось получить telegramId из сообщения: " + message);
                        continue;
                    }
                    if (chatId == null || chatId == 0) {
                        System.err.println("Не удалось получить chatId из сообщения: " + message);
                        continue;
                    }

                    if ("/start".equals(text)) {
                        // Сохраняем chatId
                        System.out.println("Сохранение chatId: telegramId=" + telegramId + ", chatId=" + chatId);
                        userService.updateChatId(telegramId, chatId);
                        sendMiniAppButton(chatId);
                    }
                } else {
                    System.err.println("В сообщении отсутствуют from или chat: " + message);
                }
            }
        }
    }

    private void sendMiniAppButton(Long chatId) {
        String inlineKeyboard = """
            {
              "inline_keyboard": [[
                {
                  "text": "Открыть RideMate",
                  "web_app": {
                    "url": "%s"
                  }
                }
              ]]
            }
            """.formatted(webappUrl);

        String body = """
            {
              "chat_id": %d,
              "text": "Привет! Нажми кнопку, чтобы открыть приложение.",
              "reply_markup": %s
            }
            """.formatted(chatId, inlineKeyboard);

        try {
            restClient.post()
                    .uri("/bot" + botToken + "/sendMessage")
                    .header("Content-Type", "application/json")
                    .body(body)
                    .retrieve()
                    .body(String.class);
        } catch (Exception e) {
            System.err.println("Ошибка при отправке кнопки: " + e.getMessage());
        }
    }

    public void sendMessage(Long chatId, String text) {
        if (chatId == null) {
            System.err.println("⚠️ sendMessage: chatId is null, message not sent: " + text);
            return;
        }
        String body = String.format(
                "{\"chat_id\": %d, \"text\": \"%s\"}",
                chatId, text.replace("\"", "\\\"").replace("\n", "\\n")
        );
        try {
            restClient.post()
                    .uri("/bot" + botToken + "/sendMessage")
                    .header("Content-Type", "application/json")
                    .body(body)
                    .retrieve()
                    .body(String.class);
        } catch (Exception e) {
            System.err.println("❌ sendMessage failed for chatId=" + chatId + ": " + e.getMessage());
        }
    }
}