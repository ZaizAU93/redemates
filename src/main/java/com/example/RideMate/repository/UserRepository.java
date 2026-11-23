package com.example.RideMate.repository;


import com.example.RideMate.entity.User;
import com.example.RideMate.entity.UserStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByTelegramId(Long telegramId);

    long countByStatus(UserStatus status);
    List<User> findByFirstNameContainingIgnoreCaseOrUsernameContainingIgnoreCase(String a, String b);

}