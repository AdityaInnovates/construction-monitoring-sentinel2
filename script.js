var corridor = geometry;

var buffer = corridor.buffer(500);

Map.centerObject(buffer, 9);
Map.addLayer(buffer, {color: 'red'}, 'Buffered Corridor');
var dataset = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED");
function getImage(start, end) {
  return dataset
    .filterDate(start, end)
    .filterBounds(buffer)
    // .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
    .median()
    .clip(buffer);
}
var t1 = getImage('2024-01-01', '2024-01-15');
var t2 = getImage('2024-06-01', '2024-06-15');
var t3 = getImage('2025-01-01', '2025-01-15');
var t4 = getImage('2025-06-01', '2025-06-15');
Map.addLayer(t1, {bands: ['B4', 'B3', 'B2'], min: 0, max: 3000}, 't1 RGB');
// Map.addLayer(t4, {bands: ['B4', 'B3', 'B2'], min: 0, max: 3000}, 't4 RGB');
function addNDVI(image) {
  var ndvi = image.normalizedDifference(['B8', 'B4']).rename('NDVI');
  return image.addBands(ndvi);
}
var t1_ndvi = addNDVI(t1);
Map.addLayer(t1_ndvi.select('NDVI'), {
  min: -1,
  max: 1,
  palette: ['brown', 'yellow', 'green']
}, 'NDVI t1');
var t2_ndvi = addNDVI(t2);
Map.addLayer(t2_ndvi.select('NDVI'), {
  min: -1,
  max: 1,
  palette: ['brown', 'yellow', 'green']
}, 'NDVI t2');

var t3_ndvi = addNDVI(t3);
var t4_ndvi = addNDVI(t4);

var ndvi_diff = t2_ndvi.select('NDVI').subtract(t1_ndvi.select('NDVI'));

Map.addLayer(ndvi_diff, {
  min: -0.5,
  max: 0.5,
  palette: ['red', 'white', 'green']
}, 'NDVI Difference');
var ndvi_diff_2 = t4_ndvi.select('NDVI')
  .subtract(t3_ndvi.select('NDVI'));

Map.addLayer(ndvi_diff_2, {
  min: -0.5,
  max: 0.5,
  palette: ['red', 'white', 'green']
}, 'NDVI Diff 2025');
function addNDBI(image) {
  var ndbi = image.normalizedDifference(['B11', 'B8']).rename('NDBI');
  return image.addBands(ndbi);
}
var t4_ndbi = addNDBI(t4);
Map.addLayer(t4_ndbi.select('NDBI'), {
  min: -1,
  max: 1,
  palette: ['black', 'white', 'blue']
}, 'NDBI t4');


// Get bounding box of corridor
var bounds = corridor.bounds();

// Get coordinates
var coords = ee.List(bounds.coordinates().get(0));

// Extract min/max
var xmin = ee.Number(ee.List(coords.get(0)).get(0));
var ymin = ee.Number(ee.List(coords.get(0)).get(1));
var xmax = ee.Number(ee.List(coords.get(2)).get(0));
var ymax = ee.Number(ee.List(coords.get(2)).get(1));

// Number of segments
var nSegments = 15;

// Create vertical slices (works because your road is roughly diagonal)
var segments = ee.FeatureCollection(
  ee.List.sequence(0, nSegments - 1).map(function(i) {
    i = ee.Number(i);

    var x1 = xmin.add(xmax.subtract(xmin).multiply(i.divide(nSegments)));
    var x2 = xmin.add(xmax.subtract(xmin).multiply(i.add(1).divide(nSegments)));

    var rect = ee.Geometry.Rectangle([x1, ymin, x2, ymax]);

    // Intersect with buffer so we only keep corridor portion
    var segGeom = rect.intersection(buffer);

    return ee.Feature(segGeom).set('id', i);
  })
);

Map.addLayer(segments.style({
  color: 'blue',
  fillColor: '00000000',
  width: 2
}), {}, 'Segments');


t1 = addNDVI(t1);
t2 = addNDVI(t2);
t3 = addNDVI(t3);
t4 = addNDVI(t4);

t1 = addNDBI(t1);
t2 = addNDBI(t2);
t3 = addNDBI(t3);
t4 = addNDBI(t4); // only needed for final stage

function addBSI(image) {
  var bsi = image.expression(
    '((SWIR + RED) - (NIR + BLUE)) / ((SWIR + RED) + (NIR + BLUE))',
    {
      'SWIR': image.select('B11'),
      'RED': image.select('B4'),
      'NIR': image.select('B8'),
      'BLUE': image.select('B2')
    }
  ).rename('BSI');

  return image.addBands(bsi);
}

t1 = addBSI(t1);
t2 = addBSI(t2);
t3 = addBSI(t3);
t4 = addBSI(t4);

function getStats(image, label) {
  return segments.map(function(seg) {
    var stats = image.reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: seg.geometry(),
      scale: 10,
      maxPixels: 1e9
    });

    return seg.set({
      'time': label,
      'NDVI': stats.get('NDVI'),
      'NDBI': stats.get('NDBI'),
      'BSI': stats.get('BSI')
    });
  });
}

var s1 = getStats(t1, 't1');
var s2 = getStats(t2, 't2');
// Join t1 and t2 by segment id
var join = ee.Join.inner();

var filter = ee.Filter.equals({
  leftField: 'id',
  rightField: 'id'
});

var joined12 = join.apply(s1, s2, filter);

// Compute NDVI change (t2 - t1)
var change12 = ee.FeatureCollection(joined12.map(function(f) {
  var f1 = ee.Feature(f.get('primary'));   // t1
  var f2 = ee.Feature(f.get('secondary')); // t2

  var dNDVI = ee.Number(f2.get('NDVI'))
                .subtract(ee.Number(f1.get('NDVI')));

  return f1.set({
    'NDVI_t1': f1.get('NDVI'),
    'NDVI_t2': f2.get('NDVI'),
    'dNDVI_12': dNDVI
  });
}));
var s3 = getStats(t3, 't3');
var s4 = getStats(t4, 't4');

// Join t3 and t4
var joined34 = ee.Join.inner().apply(
  s3, s4,
  ee.Filter.equals({ leftField: 'id', rightField: 'id' })
);

// Compute NDVI change (t4 - t3)
var change34 = ee.FeatureCollection(joined34.map(function(f) {
  var f3 = ee.Feature(f.get('primary'));   // t3
  var f4 = ee.Feature(f.get('secondary')); // t4

  var dNDVI = ee.Number(f4.get('NDVI'))
                .subtract(ee.Number(f3.get('NDVI')));

  return f3.set({
    'NDVI_t3': f3.get('NDVI'),
    'NDVI_t4': f4.get('NDVI'),
    'NDBI_t4': f4.get('NDBI'),
    'BSI_t4': f4.get('BSI'),
    'dNDVI_34': dNDVI
  });
}));

function classify2025(f) {
  var d = ee.Number(f.get('dNDVI_34'));
  var ndbi = ee.Number(f.get('NDBI_t4'));
  var bsi = ee.Number(f.get('BSI_t4'));

  var stage = ee.Algorithms.If(
    d.gt(0.05).and(ndbi.gt(0.05)),
      'Completed',                      // stabilized + built-up
    ee.Algorithms.If(
      d.lt(-0.05).and(bsi.gt(0.06)),
        'Still Under Construction',     // still active disturbance
      'Stabilizing'
    )
  );

  return f.set('stage_2025', stage);
}

var classified_2025 = change34.map(classify2025);

var all = s1.merge(s2).merge(s3).merge(s4);

function classifyChange(f) {
  var d = ee.Number(f.get('dNDVI_12'));
  var bsi = ee.Number(f.get('BSI'));

  var stage = ee.Algorithms.If(
    d.lt(-0.1).and(bsi.gt(0.06)),   // lower BSI threshold
      'Under Construction',
    ee.Algorithms.If(
      d.gt(-0.05),
        'Not Started',
      'Low Confidence'
    )
  );

  return f.set('stage', stage);
}

var classified_change = change12.map(classifyChange);

// var classified = all.map(classify);

Export.table.toDrive({
  collection: classified_change,
  description: 'Segment_Change_Classification',
  fileFormat: 'CSV'
});

print('Sample segments (change-based)', classified_change.limit(10));

print('2025 Classification', classified_2025.limit(10));

Export.table.toDrive({
  collection: classified_2025,
  description: 'Segment_2025_Classification',
  fileFormat: 'CSV'
});
