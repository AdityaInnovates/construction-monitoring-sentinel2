// ============================================
// EXPRESSWAY CONSTRUCTION ANALYSIS
// ============================================

// -------- 1. DEFINE REGION --------
var corridor = geometry;
var buffer = corridor.buffer(500);

Map.centerObject(buffer, 9);
Map.addLayer(buffer, {color: 'red'}, 'Corridor Buffer');

// -------- 2. LOAD DATA --------
var dataset = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED');

function getImage(start, end) {
  return dataset
    .filterDate(start, end)
    .filterBounds(buffer)
    .median()
    .clip(buffer);
}

// Time periods
var t1 = getImage('2024-01-01', '2024-01-15');
var t2 = getImage('2024-06-01', '2024-06-15');
var t3 = getImage('2025-01-01', '2025-01-15');
var t4 = getImage('2025-06-01', '2025-06-15');

// -------- 3. INDEX FUNCTIONS --------
function addNDVI(img) {
  return img.addBands(img.normalizedDifference(['B8', 'B4']).rename('NDVI'));
}

function addNDBI(img) {
  return img.addBands(img.normalizedDifference(['B11', 'B8']).rename('NDBI'));
}

function addBSI(img) {
  var bsi = img.expression(
    '((SWIR + RED) - (NIR + BLUE)) / ((SWIR + RED) + (NIR + BLUE))', {
      SWIR: img.select('B11'),
      RED: img.select('B4'),
      NIR: img.select('B8'),
      BLUE: img.select('B2')
    }
  ).rename('BSI');
  return img.addBands(bsi);
}

// Apply indices to all images
function enrich(img) {
  return addBSI(addNDBI(addNDVI(img)));
}

t1 = enrich(t1);
t2 = enrich(t2);
t3 = enrich(t3);
t4 = enrich(t4);

// -------- 4. VISUALIZATION --------
Map.addLayer(t1, {bands: ['B4','B3','B2'], min:0, max:3000}, 'RGB t1');
Map.addLayer(t1.select('NDVI'), {min:-1,max:1,palette:['brown','yellow','green']}, 'NDVI t1');
Map.addLayer(t2.select('NDVI'), {min:-1,max:1,palette:['brown','yellow','green']}, 'NDVI t2');

// -------- 5. SEGMENTATION --------
var bounds = corridor.bounds();
var coords = ee.List(bounds.coordinates().get(0));

var xmin = ee.Number(ee.List(coords.get(0)).get(0));
var ymin = ee.Number(ee.List(coords.get(0)).get(1));
var xmax = ee.Number(ee.List(coords.get(2)).get(0));
var ymax = ee.Number(ee.List(coords.get(2)).get(1));

var nSegments = 15;

var segments = ee.FeatureCollection(
  ee.List.sequence(0, nSegments - 1).map(function(i) {
    i = ee.Number(i);

    var x1 = xmin.add(xmax.subtract(xmin).multiply(i.divide(nSegments)));
    var x2 = xmin.add(xmax.subtract(xmin).multiply(i.add(1).divide(nSegments)));

    var rect = ee.Geometry.Rectangle([x1, ymin, x2, ymax]);
    var segGeom = rect.intersection(buffer);

    return ee.Feature(segGeom).set('id', i);
  })
);

Map.addLayer(segments.style({color:'blue', fillColor:'00000000'}), {}, 'Segments');

// -------- 6. EXTRACT STATS --------
function getStats(img, label) {
  return segments.map(function(seg) {
    var stats = img.reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: seg.geometry(),
      scale: 10,
      maxPixels: 1e9
    });

    return seg.set({
      time: label,
      NDVI: stats.get('NDVI'),
      NDBI: stats.get('NDBI'),
      BSI: stats.get('BSI')
    });
  });
}

var s1 = getStats(t1, 't1');
var s2 = getStats(t2, 't2');
var s3 = getStats(t3, 't3');
var s4 = getStats(t4, 't4');

// -------- 7. NDVI CHANGE (2024) --------
var join = ee.Join.inner();
var filter = ee.Filter.equals({leftField:'id', rightField:'id'});

var change12 = ee.FeatureCollection(join.apply(s1, s2, filter).map(function(f) {
  var f1 = ee.Feature(f.get('primary'));
  var f2 = ee.Feature(f.get('secondary'));

  var d = ee.Number(f2.get('NDVI')).subtract(f1.get('NDVI'));

  return f1.set({NDVI_t1:f1.get('NDVI'), NDVI_t2:f2.get('NDVI'), dNDVI_12:d});
}));

// -------- 8. CLASSIFY 2024 --------
function classify2024(f) {
  var d = ee.Number(f.get('dNDVI_12'));
  var bsi = ee.Number(f.get('BSI'));

  var stage = ee.Algorithms.If(
    d.lt(-0.1).and(bsi.gt(0.06)), 'Under Construction',
    ee.Algorithms.If(d.gt(-0.05), 'Not Started', 'Low Confidence')
  );

  return f.set('stage_2024', stage);
}

var result2024 = change12.map(classify2024);

// -------- 9. NDVI CHANGE (2025) --------
var change34 = ee.FeatureCollection(join.apply(s3, s4, filter).map(function(f) {
  var f3 = ee.Feature(f.get('primary'));
  var f4 = ee.Feature(f.get('secondary'));

  var d = ee.Number(f4.get('NDVI')).subtract(f3.get('NDVI'));

  return f3.set({
    NDVI_t3:f3.get('NDVI'),
    NDVI_t4:f4.get('NDVI'),
    NDBI_t4:f4.get('NDBI'),
    BSI_t4:f4.get('BSI'),
    dNDVI_34:d
  });
}));

// -------- 10. CLASSIFY 2025 --------
function classify2025(f) {
  var d = ee.Number(f.get('dNDVI_34'));
  var ndbi = ee.Number(f.get('NDBI_t4'));
  var bsi = ee.Number(f.get('BSI_t4'));

  var stage = ee.Algorithms.If(
    d.gt(0.05).and(ndbi.gt(0.05)), 'Completed',
    ee.Algorithms.If(d.lt(-0.05).and(bsi.gt(0.06)), 'Under Construction', 'Stabilizing')
  );

  return f.set('stage_2025', stage);
}

var result2025 = change34.map(classify2025);

// -------- 11. EXPORT --------
Export.table.toDrive({
  collection: result2024,
  description: 'Construction_2024',
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: result2025,
  description: 'Construction_2025',
  fileFormat: 'CSV'
});

print('2024 Results', result2024.limit(10));
print('2025 Results', result2025.limit(10));
