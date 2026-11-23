package com.example.RideMate.repository;

import com.example.RideMate.entity.SupportMessage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface SupportMessageRepository extends JpaRepository<SupportMessage, Long> {

    List<SupportMessage> findAllByOrderByStatusAscCreatedAtDesc();

    long countByStatus(String status);

    @Query("SELECT COUNT(m) FROM SupportMessage m " +
            "WHERE m.userTelegramId = :tid AND m.createdAt > :since")
    long countRecentByUser(@Param("tid") Long telegramId, @Param("since") LocalDateTime since);
}
