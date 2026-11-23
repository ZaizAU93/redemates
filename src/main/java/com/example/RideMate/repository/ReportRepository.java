package com.example.RideMate.repository;

import com.example.RideMate.entity.Report;
import com.example.RideMate.entity.ReportStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface ReportRepository extends JpaRepository<Report, Long> {

    boolean existsByReporterIdAndReportedId(Long reporterId, Long reportedId);

    List<Report> findByStatusOrderByCreatedAtDesc(ReportStatus status);

    // Сколько РАЗНЫХ людей жаловались на пользователя (отклонённые модератором не считаем)
    @Query("select count(distinct r.reporter.id) from Report r " +
            "where r.reported.id = :userId and r.status <> com.example.RideMate.entity.ReportStatus.DISMISSED")
    long countDistinctReporters(@Param("userId") Long userId);
}
