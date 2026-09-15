package com.example.RideMate.controller;


import com.example.RideMate.dto.MessageDTO;
import com.example.RideMate.service.MessageService;
import com.example.RideMate.service.TelegramAuthService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/messages")
@CrossOrigin
public class MessageController {

    private final MessageService messageService;
    private final TelegramAuthService authService;

    public MessageController(MessageService messageService, TelegramAuthService authService) {
        this.messageService = messageService;
        this.authService = authService;
    }

    @PostMapping("/{matchId}")
    public MessageDTO sendMessage(@PathVariable Long matchId,
                                  @RequestBody SendMessageRequest request,
                                  @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long senderTelegramId = authService.authenticate(initData);
        return messageService.sendMessage(matchId, senderTelegramId, request.text());
    }

    @GetMapping("/{matchId}")
    public List<MessageDTO> getMessages(@PathVariable Long matchId,
                                        @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long requesterTelegramId = authService.authenticate(initData);
        return messageService.getMessagesForMatch(matchId, requesterTelegramId);
    }

    public record SendMessageRequest(String text) {}
}