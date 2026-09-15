package com.example.RideMate.service;


import com.example.RideMate.dto.GeocodingResult;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.Arrays;
import java.util.List;

@Service
public class NominatimGeocodingService implements GeocodingService {

    private final RestClient restClient;

    public NominatimGeocodingService() {
        this.restClient = RestClient.builder()
                .baseUrl("https://nominatim.openstreetmap.org")
                .defaultHeader("User-Agent", "RideMate/1.0")
                .defaultHeader("Accept-Language", "ru")
                .build();
    }

    @Override
    public List<GeocodingResult> search(String query) {
        NominatimResponse[] response = restClient.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/search")
                        .queryParam("q", query)
                        .queryParam("format", "json")
                        .queryParam("limit", 5)
                        .build())
                .retrieve()
                .body(NominatimResponse[].class);

        if (response == null) {
            return List.of();
        }

        return Arrays.stream(response)
                .map(item -> new GeocodingResult(
                        item.display_name(),
                        Double.parseDouble(item.lat()),
                        Double.parseDouble(item.lon())
                ))
                .toList();
    }

    private record NominatimResponse(
            String display_name,
            String lat,
            String lon
    ) {
    }
}