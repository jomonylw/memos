package getter

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"
)

var cgnatNet = &net.IPNet{
	IP:   net.ParseIP("100.64.0.0"),
	Mask: net.CIDRMask(10, 32),
}

func isPrivateIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsInterfaceLocalMulticast() || ip.IsUnspecified() {
		return true
	}
	if ip.IsPrivate() {
		return true
	}
	if cgnatNet.Contains(ip) {
		return true
	}
	return false
}

var safeTransport = &http.Transport{
	Proxy: http.ProxyFromEnvironment,
	DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
		if len(ips) == 0 {
			return nil, errors.New("no IP address found for host")
		}
		var dialIP net.IP
		for _, ip := range ips {
			if isPrivateIP(ip) {
				return nil, errors.New("access to private IP address is prohibited")
			}
			if dialIP == nil {
				dialIP = ip
			}
		}
		dialer := &net.Dialer{
			Timeout: 3 * time.Second,
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(dialIP.String(), port))
	},
	TLSHandshakeTimeout:   3 * time.Second,
	ResponseHeaderTimeout: 3 * time.Second,
}

var SafeHTTPClient = &http.Client{
	Transport: safeTransport,
	Timeout:   4 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many redirects")
		}
		if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
			return errors.New("invalid redirect protocol")
		}
		return nil
	},
}
