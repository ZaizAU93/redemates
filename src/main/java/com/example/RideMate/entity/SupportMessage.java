package com.example.RideMate.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "support_messages")
public class SupportMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_telegram_id", nullable = false)
    private Long userTelegramId;

    @Column(nullable = false)
    private String topic;      // PROBLEM / IDEA / QUESTION

    @Column(nullable = false)
    private String message;

    @Column(nullable = false)
    private String status = "NEW";   // NEW / RESOLVED

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt = LocalDateTime.now();

    public Long getId() { return id; }
    public Long getUserTelegramId() { return userTelegramId; }
    public void setUserTelegramId(Long v) { this.userTelegramId = v; }
    public String getTopic() { return topic; }
    public void setTopic(String v) { this.topic = v; }
    public String getMessage() { return message; }
    public void setMessage(String v) { this.message = v; }
    public String getStatus() { return status; }
    public void setStatus(String v) { this.status = v; }
    public LocalDateTime getCreatedAt() { return createdAt; }
}
