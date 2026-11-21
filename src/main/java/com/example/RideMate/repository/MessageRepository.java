package com.example.RideMate.repository;

import com.example.RideMate.entity.Message;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface MessageRepository extends JpaRepository<Message, Long> {
    List<Message> findByMatchIdOrderByCreatedAtAsc(Long matchId);

    /** Последнее сообщение каждого чата пользователя. */
    @Query("""
            SELECT m FROM Message m
            WHERE m.id IN (SELECT MAX(x.id) FROM Message x
                           WHERE x.match.responder.id = :userId
                              OR x.match.rideRequest.user.id = :userId
                           GROUP BY x.match.id)
            ORDER BY m.createdAt DESC
            """)
    List<Message> findLastMessagesForUser(@Param("userId") Long userId);

    /** Всего непрочитанных по всем чатам пользователя. */
    @Query("""
            SELECT COUNT(m) FROM Message m
            WHERE m.isRead = false
              AND m.sender.id <> :userId
              AND (m.match.responder.id = :userId OR m.match.rideRequest.user.id = :userId)
            """)
    long countUnreadForUser(@Param("userId") Long userId);

    /** Непрочитанные в разрезе чатов: [matchId, количество]. */
    @Query("""
            SELECT m.match.id, COUNT(m) FROM Message m
            WHERE m.isRead = false
              AND m.sender.id <> :userId
              AND (m.match.responder.id = :userId OR m.match.rideRequest.user.id = :userId)
            GROUP BY m.match.id
            """)
    List<Object[]> countUnreadByMatchForUser(@Param("userId") Long userId);
}
