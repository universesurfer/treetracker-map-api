var express = require('express');
var bodyParser = require('body-parser');
var http = require('http');
var pg = require('pg');
const { Pool, Client } = require('pg');
var path = require('path');
var app = express();
var port = process.env.NODE_PORT || 3000;
var conn = require('./config');

app.use(bodyParser.urlencoded({ extended: false })); // parse application/x-www-form-urlencoded
app.use(bodyParser.json()); // parse application/json
app.set('view engine', 'html');

const pool = new Pool({
  connectionString: conn.connectionString
});


app.get('/trees', function (req, res) {
  console.log(req);

  let token = req.query['token'];
  let organization = req.query['organization'];
  let treeid = req.query['treeid'];
  let join = '';
  let joinCriteria = '';
  let filter = '';
  let subset = false;
  if (token) {
    join = "INNER JOIN certificates ON trees.certificate_id = certificates.id AND certificates.token = '" + token + "'";
    subset = true;
  } else if(organization) {
    join = ", certificates, donors, organizations";
    joinCriteria = "AND trees.certificate_id = certificates.id AND certificates.donor_id = donors.id AND donors.organization_id = organizations.id AND organizations.id = " + organization;
    subset = true;
  } else if(treeid) {
    filter = 'AND trees.id = ' + treeid + ' '
    subset = true;
  }

  let bounds = req.query['bounds'];
  let boundingBoxQuery = '';
  if (bounds) {
    boundingBoxQuery = 'AND trees.estimated_geometric_location && ST_MakeEnvelope(' + bounds + ', 4326) ';
  }

  let clusterRadius = parseFloat(req.query['clusterRadius']);
  console.log(clusterRadius);
  var sql, query
  if (clusterRadius <= 0.001) {

    sql = "SELECT 'point' AS type, trees.*, users.first_name as first_name, users.last_name as last_name, users.image_url as user_image_url FROM trees INNER JOIN users ON users.id = trees.user_id " + join + " WHERE active = true " + boundingBoxQuery + filter + joinCriteria;
    query = {
      text: sql
    }

  }
  else {

    // check if query is in the cached zone
    boundingBox = bounds.split(',');
    //37.920688261865735,-2.5769945571374615,36.365024199365735,-4.088867604371135
    if(boundingBox[0]  <= 37.920688261865735 
      && boundingBox[1] <= -2.5769945571374615
      && boundingBox[2] >= 36.365024199365735
      && boundingBox[3] >= -4.088867604371135){

      sql = `SELECT 'cluster' as type,
             St_asgeojson(location) centroid, count 
             FROM clusters
             WHERE zoom_level = ` + req.query['zoom_level'] + ' AND location && ST_MakeEnvelope(' + bounds + ', 4326) ';
      query = {
        text: sql
      }
      console.log(query);

    } else {

      sql = `SELECT 'cluster'                                                   AS type, 
        St_asgeojson(St_centroid(clustered_locations))                 centroid, 
        --St_asgeojson(St_minimumboundingcircle(clustered_locations))    circle, 
        St_numgeometries(clustered_locations)                          count 
      FROM   ( 
        SELECT Unnest(St_clusterwithin(estimated_geometric_location, $1)) clustered_locations
        FROM   trees ` + join + ` 
        WHERE  active = true ` + boundingBoxQuery + filter + joinCriteria + ` ) clusters`;
      query = {
        text: sql,
        values: [clusterRadius]
      }
    }
  }

  pool.query(query)
    .then(function (data) {
      res.status(200).json({
        data: data.rows
      })
    })
    .catch(e => console.error(e.stack));

});

app.listen(port, () => {
  console.log('listening on port ' + port);
});
