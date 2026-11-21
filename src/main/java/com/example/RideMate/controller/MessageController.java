package com.example.RideMate.controller;

import com.example.RideMate.dto.ChatDTO;
import com.example.RideMate.dto.MessageDTO;
import com.example.RideMate.service.MessageService;
import com.example.RideMate.service.TelegramAuthService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

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

    /** Список чатов: собеседник, последнее сообщение, непрочитанные. */
    @GetMapping("/chats")
    public List<ChatDTO> getChats(@RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);
        return messageService.getChats(telegramId);
    }

    /** Общее число непрочитанных — для бейджа на вкладке. */
    @GetMapping("/unread")
    public Map<String, Long> getUnread(@RequestHeader("X-Telegram-Init-Data") String initData) {
        Long telegramId = authService.authenticate(initData);
        return Map.of("unread", messageService.getUnreadTotal(telegramId));
    }

    @GetMapping("/{matchId}")
    public List<MessageDTO> getMessages(@PathVariable Long matchId,
                                        @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long requesterTelegramId = authService.authenticate(initData);
        return messageService.getMessagesForMatch(matchId, requesterTelegramId);
    }

    @PostMapping("/{matchId}")
    public MessageDTO sendMessage(@PathVariable Long matchId,
                                  @RequestBody SendMessageRequest request,
                                  @RequestHeader("X-Telegram-Init-Data") String initData) {
        Long senderTelegramId = authService.authenticate(initData);
        return messageService.sendMessage(matchId, senderTelegramId, request.text());
    }

    public record SendMessageRequest(String text) {}
}
