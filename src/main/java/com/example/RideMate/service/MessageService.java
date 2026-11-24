package com.example.RideMate.service;

import com.example.RideMate.dto.ChatDTO;
import com.example.RideMate.dto.MessageDTO;
import com.example.RideMate.entity.*;
import com.example.RideMate.repository.MatchRepository;
import com.example.RideMate.repository.MessageRepository;
import com.example.RideMate.repository.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
public class MessageService {

    /** Статусы, в которых чат открыт. PENDING/REJECTED — переписки ещё нет. */
    private static final Set<MatchStatus> CHAT_ALLOWED =
            Set.of(MatchStatus.CONFIRMING, MatchStatus.CONFIRMED, MatchStatus.COMPLETED);

    private static final int MAX_TEXT_LENGTH = 2000;

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

    // ---------- Отправка ----------

    @Transactional
    public MessageDTO sendMessage(Long matchId, Long senderTelegramId, String text) {
        Match match = matchRepository.findById(matchId)
                .orElseThrow(() -> new RuntimeException("Матч не найден"));

        Long ownerTelegramId = match.getRideRequest().getUser().getTelegramId();
        Long responderTelegramId = match.getResponder().getTelegramId();
        if (!senderTelegramId.equals(ownerTelegramId) && !senderTelegramId.equals(responderTelegramId)) {
            throw new RuntimeException("Вы не участник этого матча");
        }
        if (!CHAT_ALLOWED.contains(match.getStatus())) {
            throw new RuntimeException("Чат доступен после подтверждения брони");
        }

        if (text == null || text.isBlank()) {
            throw new RuntimeException("Пустое сообщение");
        }
        String clean = text.trim();
        if (clean.length() > MAX_TEXT_LENGTH) {
            throw new RuntimeException("Сообщение слишком длинное (максимум " + MAX_TEXT_LENGTH + " символов)");
        }

        Long receiverTelegramId = senderTelegramId.equals(ownerTelegramId) ? responderTelegramId : ownerTelegramId;
        if (safetyService.isBlocked(senderTelegramId, receiverTelegramId) ||
                safetyService.isBlocked(receiverTelegramId, senderTelegramId)) {
            throw new RuntimeException("Невозможно отправить сообщение: пользователь заблокирован");
        }

        User sender = userRepository.findByTelegramId(senderTelegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));

        Message message = new Message();
        message.setMatch(match);
        message.setSender(sender);
        message.setText(clean);
        message = messageRepository.save(message);

        User receiver = userRepository.findByTelegramId(receiverTelegramId).orElse(null);
        if (receiver != null && receiver.getChatId() != null) {
            String preview = clean.length() > 80 ? clean.substring(0, 80) + "…" : clean;
            telegramBotService.sendMessage(receiver.getChatId(),
                    "💬 Новое сообщение от " + (sender.getFirstName() != null ? sender.getFirstName() : "пользователя")
                            + ": " + preview);
        }

        return toDTO(message, senderTelegramId);
    }

    // ---------- История (с отметкой о прочтении) ----------

    @Transactional
    public List<MessageDTO> getMessagesForMatch(Long matchId, Long requesterTelegramId) {
        Match match = matchRepository.findById(matchId)
                .orElseThrow(() -> new RuntimeException("Матч не найден"));
        Long ownerTelegramId = match.getRideRequest().getUser().getTelegramId();
        Long responderTelegramId = match.getResponder().getTelegramId();
        if (!requesterTelegramId.equals(ownerTelegramId) && !requesterTelegramId.equals(responderTelegramId)) {
            throw new RuntimeException("Вы не участник этого матча");
        }

        User requester = userRepository.findByTelegramId(requesterTelegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));

        List<Message> messages = messageRepository.findByMatchIdOrderByCreatedAtAsc(matchId);

        // Входящие помечаем прочитанными
        boolean changed = false;
        for (Message m : messages) {
            if (!m.getSender().getId().equals(requester.getId()) && !Boolean.TRUE.equals(m.getIsRead())) {
                m.setIsRead(true);
                changed = true;
            }
        }
        if (changed) {
            messageRepository.saveAll(messages);
        }

        return messages.stream()
                .map(m -> toDTO(m, requesterTelegramId))
                .toList();
    }

    // ---------- Список чатов ----------

    @Transactional(readOnly = true)
    public List<ChatDTO> getChats(Long telegramId) {
        User me = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));

        Set<Long> seenMatchIds = new HashSet<>();
        List<Match> allMatches = new ArrayList<>();
        for (Match m : matchRepository.findByRideRequestUserId(me.getId())) {
            if (CHAT_ALLOWED.contains(m.getStatus()) && seenMatchIds.add(m.getId())) allMatches.add(m);
        }
        for (Match m : matchRepository.findByResponderId(me.getId())) {
            if (CHAT_ALLOWED.contains(m.getStatus()) && seenMatchIds.add(m.getId())) allMatches.add(m);
        }

        Map<Long, Message> lastByMatch = new HashMap<>();
        for (Message m : messageRepository.findLastMessagesForUser(me.getId())) {
            lastByMatch.put(m.getMatch().getId(), m);
        }
        Map<Long, Long> unreadByMatch = new HashMap<>();
        for (Object[] row : messageRepository.countUnreadByMatchForUser(me.getId())) {
            unreadByMatch.put((Long) row[0], (Long) row[1]);
        }

        // Используем Map для дедупликации по ID собеседника
        Map<Long, ChatDTO> uniqueChats = new LinkedHashMap<>();

        for (Match m : allMatches) {
            RideRequest ride = m.getRideRequest();
            boolean iAmOwner = ride.getUser().getId().equals(me.getId());
            User peer = iAmOwner ? m.getResponder() : ride.getUser();

            Message last = lastByMatch.get(m.getId());
            ChatDTO chat = new ChatDTO(
                    m.getId(),
                    ride.getId(),
                    peer.getFirstName() != null && !peer.getFirstName().isBlank() ? peer.getFirstName() : "Пользователь",
                    peer.getUsername(),
                    peer.getTelegramId(),
                    last != null ? last.getText() : null,
                    last != null ? last.getCreatedAt() : null,
                    unreadByMatch.getOrDefault(m.getId(), 0L),
                    m.getStatus().name()
            );

            Long peerId = peer.getId();
            if (!uniqueChats.containsKey(peerId)) {
                uniqueChats.put(peerId, chat);
            } else {
                // Если чат уже есть, оставляем тот, где есть последнее сообщение (или более новое)
                ChatDTO existing = uniqueChats.get(peerId);
                if (chat.lastMessageTime() != null) {
                    if (existing.lastMessageTime() == null || chat.lastMessageTime().isAfter(existing.lastMessageTime())) {
                        uniqueChats.put(peerId, chat);
                    }
                }
            }
        }

        List<ChatDTO> chats = new ArrayList<>(uniqueChats.values());
        chats.sort(Comparator.comparing(ChatDTO::lastMessageTime,
                Comparator.nullsLast(Comparator.reverseOrder())));
        return chats;
    }

    // ---------- Бейдж непрочитанных ----------

    @Transactional(readOnly = true)
    public long getUnreadTotal(Long telegramId) {
        User me = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        return messageRepository.countUnreadForUser(me.getId());
    }

    // ---------- Вспомогательное ----------

    private MessageDTO toDTO(Message m, Long viewerTelegramId) {
        return new MessageDTO(
                m.getId(),
                m.getMatch().getId(),
                m.getSender().getTelegramId(),
                (m.getSender().getFirstName() != null ? m.getSender().getFirstName() : "Пользователь")
                        + (m.getSender().getLastName() != null ? " " + m.getSender().getLastName() : ""),
                m.getText(),
                m.getCreatedAt(),
                m.getSender().getTelegramId().equals(viewerTelegramId),
                Boolean.TRUE.equals(m.getIsRead())
        );
    }
}
