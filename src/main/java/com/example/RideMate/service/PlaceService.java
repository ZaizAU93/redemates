package com.example.RideMate.service;

import com.example.RideMate.dto.LocationRequest;
import com.example.RideMate.entity.Place;
import com.example.RideMate.repository.PlaceRepository;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.GeometryFactory;
import org.locationtech.jts.geom.Point;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class PlaceService {

    private final PlaceRepository placeRepository;
    private final GeometryFactory geometryFactory;

    public PlaceService(PlaceRepository placeRepository, GeometryFactory geometryFactory) {
        this.placeRepository = placeRepository;
        this.geometryFactory = geometryFactory;
    }


    public Place savePlace(LocationRequest request) {
        Place place = new Place();
        place.setName(request.name());

        Point point = geometryFactory.createPoint(
                new Coordinate(request.longitude(), request.latitude())
        );
        place.setLocation(point);

        return placeRepository.save(place);
    }

    public List<Place> findNearest(double lat, double lon) {
        return placeRepository.findNearestPlaces(lat, lon);
    }
}