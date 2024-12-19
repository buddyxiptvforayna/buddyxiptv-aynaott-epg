const express = require('express');
const axios = require('axios');
const { create } = require('xmlbuilder2');
const moment = require('moment-timezone');
const compression = require('compression');
const NodeCache = require('node-cache');

// Initialize express and cache
const app = express();
const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour
app.use(compression());

// Utility functions
const formatTimestamp = (timestamp) => {
    try {
        return moment.unix(timestamp)
            .tz('Asia/Dhaka')
            .format('YYYYMMDDHHmmss ZZ');
    } catch {
        return '';
    }
};

const validateProgramTimes = (start, end) => {
    try {
        const startTime = parseInt(start);
        const endTime = parseInt(end);
        return startTime > 0 && endTime > startTime;
    } catch {
        return false;
    }
};

const getApiUrls = () => {
    const baseUrl = "https://cloudtv.akamaized.net/AynaOTT/BDcontent/channels/epg/652fcf82a2649538da6fc6e3_{}_minified_bundle.json";
    return Array.from({ length: 3 }, (_, i) => {
        const date = moment().add(i, 'days').format('DD-MM-YYYY');
        return baseUrl.replace('{}', date);
    });
};

// EPG Route with caching
app.get('/api/aynaepg.xml', async (req, res) => {
    try {
        // Check cache first
        const cachedData = cache.get('epg');
        if (cachedData) {
            res.set('Content-Type', 'application/xml');
            return res.send(cachedData);
        }

        // Fetch channel info
        const channelResponse = await axios.get("https://ayna-api.buddyxiptv.com/api/aynaott.json");
        const channelInfo = channelResponse.data.channels.reduce((acc, channel) => {
            acc[channel.id] = {
                name: channel.name,
                category: channel.categoryName,
                logo: channel.logo
            };
            return acc;
        }, {});

        // Create XML document
        const doc = create({ version: '1.0', encoding: 'UTF-8' })
            .ele('tv', {
                'generator-info-name': 'Bangladesh EPG Generator',
                'generator-info-url': ''
            });

        const processedChannels = new Set();

        // Fetch and process EPG data
        for (const url of getApiUrls()) {
            try {
                const response = await axios.get(url);
                const data = response.data;

                data.forEach(channel => {
                    const channelId = channel.i || 'unknown_id';
                    const channelName = channel.n || 'unknown_name';

                    // Add channel only once
                    if (!processedChannels.has(channelId)) {
                        const channelElement = doc.ele('channel', { id: channelId });

                        if (channelInfo[channelId]) {
                            channelElement.ele('display-name').txt(channelInfo[channelId].name);
                            channelElement.ele('category').txt(channelInfo[channelId].category);
                            channelElement.ele('icon', { src: channelInfo[channelId].logo });
                        } else {
                            channelElement.ele('display-name').txt(channelName);
                        }

                        processedChannels.add(channelId);
                    }

                    // Process programs
                    const programs = channel.epg || [];
                    programs.sort((a, b) => parseInt(a.s) - parseInt(b.s));

                    programs.forEach(program => {
                        if (!validateProgramTimes(program.s, program.e)) return;

                        const startTime = formatTimestamp(program.s);
                        const endTime = formatTimestamp(program.e);

                        if (startTime && endTime) {
                            const programElement = doc.ele('programme', {
                                start: startTime,
                                stop: endTime,
                                channel: channelId
                            });

                            programElement.ele('title', { lang: 'bn' })
                                .txt(program.n || 'Unknown Program');
                            programElement.ele('desc', { lang: 'bn' })
                                .txt(program.d || 'No description available');
                        }
                    });
                });

            } catch (error) {
                console.error(`Failed to fetch data for ${url}:`, error);
            }
        }

        // Generate final XML
        const xmlOutput = doc.end({ prettyPrint: true });
        
        // Cache the result
        cache.set('epg', xmlOutput);

        // Send response
        res.set('Content-Type', 'application/xml');
        res.send(xmlOutput);

    } catch (error) {
        console.error('Error generating EPG:', error);
        res.status(500).send('Error generating EPG');
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`EPG Server running on port ${PORT}`);
}); 