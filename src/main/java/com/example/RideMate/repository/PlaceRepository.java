package com.example.RideMate.repository;


import com.example.RideMate.entity.Place;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface PlaceRepository extends JpaRepository<Place, Long> {

    @Query(value = """
            SELECT * FROM places 
            ORDER BY location <-> ST_SetSRID(ST_MakePoint(:lon, :lat), 4326) 
            LIMIT 10
            """, nativeQuery = true)
    List<Place> findNearestPlaces(@Param("lat") double lat, @Param("lon") double lon);
}