package com.example.RideMate.service;

import com.example.RideMate.entity.Role;
import com.example.RideMate.entity.User;
import com.example.RideMate.repository.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserService {

    private final UserRepository userRepository;

    public UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    @Transactional
    public User registerOrUpdate(Long telegramId, String username,
                                 String firstName, String lastName,
                                 String languageCode, Boolean isPremium) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseGet(User::new);
        user.setTelegramId(telegramId);
        user.setUsername(username);
        user.setFirstName(firstName);
        user.setLastName(lastName);
        user.setLanguageCode(languageCode);
        user.setPremium(isPremium);
        return userRepository.save(user);
    }

    @Transactional
    public User updateRole(Long telegramId, Role role) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
        user.setRole(role);
        return userRepository.save(user);
    }

    // Новый метод
    @Transactional
    public void updateChatId(Long telegramId, Long chatId) {
        User user = userRepository.findByTelegramId(telegramId)
                .orElseGet(() -> {
                    User newUser = new User();
                    newUser.setTelegramId(telegramId);
                    return newUser;
                });
        user.setChatId(chatId);
        userRepository.save(user);
    }

    @Transactional(readOnly = true)
    public User getUserByTelegramId(Long telegramId) {
        return userRepository.findByTelegramId(telegramId)
                .orElseThrow(() -> new RuntimeException("Пользователь не найден"));
    }


    public static String detectCurrencyByPhone(String phone) {
        if (phone == null) return "USD";
        String digits = phone.replaceAll("[^0-9]", "");
        if (digits.startsWith("375")) return "BYN";
        if (digits.startsWith("7")) return "RUB";  // Россия и Казахстан — обе используют RUB как основную
        if (digits.startsWith("998")) return "UZS";
        if (digits.startsWith("996")) return "KZT"; // упрощённо, можно уточнить
        if (digits.startsWith("992")) return "USD";
        if (digits.startsWith("374")) return "USD";
        if (digits.startsWith("994")) return "USD";
        return "USD";
    }
}