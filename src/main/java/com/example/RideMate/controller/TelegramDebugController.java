package com.example.RideMate.controller;


import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

@RestController
public class TelegramDebugController {

    @Value("${telegram.bot-token}")
    private String botToken;

    @GetMapping("/debug/telegram-bot")
    public ResponseEntity<String> checkTelegramBot() {

        try {

            String token = botToken == null ? "" : botToken.trim();

            if (token.isBlank()) {
                return ResponseEntity.ok(
                        "{\"success\":false,\"error\":\"BOT TOKEN EMPTY\"}"
                );
            }

            System.out.println("==============================================");
            System.out.println("TELEGRAM BOT TOKEN DEBUG");
            System.out.println("Token length: " + token.length());
            System.out.println(
                    "Token prefix: " +
                            token.substring(0, Math.min(10, token.length()))
            );
            System.out.println(
                    "Token suffix: " +
                            token.substring(
                                    Math.max(0, token.length() - 6)
                            )
            );
            System.out.println("==============================================");

            String url =
                    "https://api.telegram.org/bot" +
                            token +
                            "/getMe";

            HttpClient client = HttpClient.newHttpClient();

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .GET()
                    .build();

            HttpResponse<String> response =
                    client.send(
                            request,
                            HttpResponse.BodyHandlers.ofString()
                    );

            System.out.println("Telegram getMe response:");
            System.out.println(response.body());

            return ResponseEntity.ok(response.body());

        } catch (Exception e) {

            e.printStackTrace();

            return ResponseEntity.ok(
                    "{\"success\":false,\"error\":\"" +
                            e.getMessage() +
                            "\"}"
            );
        }
    }
}