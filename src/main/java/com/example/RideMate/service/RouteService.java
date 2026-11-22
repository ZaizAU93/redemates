package com.example.RideMate.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.LineString;
import org.locationtech.jts.geom.Point;
import org.locationtech.jts.geom.PrecisionModel;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.List;

@Service
public class RouteService {

    // Публичный демо-сервер OSRM: бесплатный, без ключей. Для продакшена лучше свой инстанс.
    private static final String OSRM_BASE = "https://router.project-osrm.org/route/v1/driving/";

    private final RestTemplate rest = new RestTemplate();
    private final ObjectMapper mapper = new ObjectMapper();
    private final GeometryFactory geometryFactory = new GeometryFactory(new PrecisionModel(), 4326);

    /**
     * Строит дорожный маршрут: from → промежуточные точки → to.
     * Если OSRM недоступен — откатываемся на прямую линию через те же точки,
     * чтобы создание заявки никогда не падало.
     */
    public LineString buildRoute(Point from, List<double[]> waypoints, Point to) {
        List<double[]> points = new ArrayList<>();
        points.add(new double[]{from.getY(), from.getX()}); // [lat, lon]
        if (waypoints != null) points.addAll(waypoints);
        points.add(new double[]{to.getY(), to.getX()});

        StringBuilder coords = new StringBuilder();
        for (double[] p : points) {
            if (coords.length() > 0) coords.append(';');
            coords.append(p[1]).append(',').append(p[0]); // OSRM ждёт lon,lat
        }

        try {
            String url = OSRM_BASE + coords + "?overview=full&geometries=geojson";
            String body = rest.getForObject(url, String.class);
            JsonNode root = mapper.readTree(body);
            JsonNode coordsNode = root.path("routes").path(0).path("geometry").path("coordinates");
            if (!"Ok".equals(root.path("code").asText()) || !coordsNode.isArray() || coordsNode.size() < 2) {
                return fallbackLine(points);
            }
            List<Coordinate> list = new ArrayList<>();
            for (JsonNode c : coordsNode) {
                list.add(new Coordinate(c.get(0).asDouble(), c.get(1).asDouble()));
            }
            LineString line = geometryFactory.createLineString(list.toArray(new Coordinate[0]));
            line.setSRID(4326);
            return line;
        } catch (Exception e) {
            // Сеть недоступна или OSRM вернул ошибку — прямая линия вместо дорожного маршрута
            return fallbackLine(points);
        }
    }

    private LineString fallbackLine(List<double[]> points) {
        Coordinate[] arr = new Coordinate[points.size()];
        for (int i = 0; i < points.size(); i++) {
            arr[i] = new Coordinate(points.get(i)[1], points.get(i)[0]); // lon, lat
        }
        LineString line = geometryFactory.createLineString(arr);
        line.setSRID(4326);
        return line;
    }
}
