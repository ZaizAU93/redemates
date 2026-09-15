package com.example.RideMate.service;


import com.example.RideMate.dto.MessageDTO;
import com.example.RideMate.entity.*;
import com.example.RideMate.repository.*;
import lombok.Data;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class MessageService {

    private final MessageRepository messageRepository;
    private final MatchRepository matchRepository;
    private final UserRepository userRepository;
    private final TelegramBotService telegramBotService;
    private final SafetyService safetyService;

    public MessageService(MessageRepository messageRepository,
                          MatchRepository matchRepository,
                          UserRepository userRepository,
                          TelegramBotService telegramBotService,
                          SafetyService safetyService) {
        this.messageRepository = messageRepository;
        this.matchRepository = matchRepository;
        this.userRepository = userRepository;
        this.telegramBotService = telegramBotService;
        this.safetyService = safetyService;
    }

    @Transactional
    public MessageDTO sendMessage(Long matchId, Long senderTelegramId, String text) {
        Match match = matchRepository.findById(matchId)
                .orElseThrow(() -> new RuntimeException("Матч не найден"));
        User sender = userRepository.findByTelegramId(senderTelegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));

        Long ownerTelegramId = match.getRideRequest().getUser().getTelegramId();
        Long responderTelegramId = match.getResponder().getTelegramId();
        Long receiverTelegramId = senderTelegramId.equals(ownerTelegramId) ? responderTelegramId : ownerTelegramId;

        // Проверка блокировки
        if (safetyService.isBlocked(senderTelegramId, receiverTelegramId) ||
                safetyService.isBlocked(receiverTelegramId, senderTelegramId)) {
            throw new RuntimeException("Невозможно отправить сообщение: пользователь заблокирован");
        }

        Message message = new Message();
        message.setMatch(match);
        message.setSender(sender);
        message.setText(text);
        message = messageRepository.save(message);

        // Уведомляем вторую сторону через Telegram бота
        User receiver = userRepository.findByTelegramId(receiverTelegramId).orElse(null);
        if (receiver != null && receiver.getChatId() != null) {
            telegramBotService.sendMessage(receiver.getChatId(),
                    "💬 Новое сообщение от " + sender.getFirstName() + ": " + text);
        }

        return toDTO(message);
    }

    public List<MessageDTO> getMessagesForMatch(Long matchId, Long requesterTelegramId) {
        Match match = matchRepository.findById(matchId)
                .orElseThrow(() -> new RuntimeException("Матч не найден"));
        Long ownerTelegramId = match.getRideRequest().getUser().getTelegramId();
        Long responderTelegramId = match.getResponder().getTelegramId();
        if (!requesterTelegramId.equals(ownerTelegramId) && !requesterTelegramId.equals(responderTelegramId)) {
            throw new RuntimeException("Вы не участник этого матча");
        }
        return messageRepository.findByMatchIdOrderByCreatedAtAsc(matchId)
                .stream()
                .map(this::toDTO)
                .toList();
    }

    private MessageDTO toDTO(Message m) {
        return new MessageDTO(
                m.getId(),
                m.getMatch().getId(),
                m.getSender().getTelegramId(),
                m.getSender().getFirstName() + " " + (m.getSender().getLastName() != null ? m.getSender().getLastName() : ""),
                m.getText(),
                m.getCreatedAt()
        );
    }
}